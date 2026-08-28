import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { validateOwnedAttemptAudioPath } from '@/lib/attempts/audio-path'
import { isLegacyRecheckSnapshot } from '@/lib/attempts/legacy-recheck'
import {
  ATTEMPT_FAILURE_CODES,
  canRunScoring,
  classifyAttemptRubric,
  shouldUseV2Assembler,
} from '@/lib/attempts/lifecycle'
import {
  authenticatedAttemptContext,
  logAttemptDiagnostic,
  markOwnedAttemptFailure,
  transitionOwnedAttempt,
} from '@/lib/attempts/server'
import { createDeepSeekModel, reportContentProviderFailure } from '@/lib/deepseek/provider'
import {
  CONTENT_SYSTEM_PROMPT,
  REWRITE_SYSTEM_PROMPT,
  buildContentUserPrompt,
  buildRewriteRetryPrompt,
} from '@/lib/deepseek/prompt'
import { azureSpeechConfig, deepseekApiKey } from '@/lib/env/server'
import { createAzurePronunciationProvider } from '@/lib/pronunciation/azure'
import { collectPronunciationEvidence } from '@/lib/pronunciation/orchestrate'
import { SCORE_VERSION, assembleScore } from '@/lib/scoring/assemble'
import { notCheckedContent } from '@/lib/scoring/content'
import { validLegacyDisputes } from '@/lib/scoring/disputes'
import { runContentCheckSafely } from '@/lib/scoring/run-content'
import { computeMechanical } from '@/lib/scoring/mechanical'
import { surfacesToDelete } from '@/lib/scoring/tighten'
import { analyseFillers } from '@/lib/scoring/fillers'
import { buildTokens } from '@/lib/scoring/tokens'
import {
  contentModelWithinBudget,
  createWorkBudget,
  settleWithinWorkBudget,
} from '@/lib/scoring/work-budget'
import {
  assembleV2Score,
  isPracticeMode,
  shouldReuseStoredV2Score,
} from '@/lib/scoring/v2/assemble'
import { analyseClarity } from '@/lib/scoring/v2/clarity'
import { contentDetectorFromModel } from '@/lib/scoring/v2/content/adapter'
import type { V2ContentDetectorProvider } from '@/lib/scoring/v2/content/contracts'
import { runV2ContentEvaluation } from '@/lib/scoring/v2/content/evaluate'
import { evaluateDelivery } from '@/lib/scoring/v2/delivery'
import { evaluateFluency } from '@/lib/scoring/v2/fluency'
import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { AttemptMetrics } from '@/lib/types/metrics'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { SCORING_PROVIDER_TIMEOUT_MS, SCORING_WORK_BUDGET_MS } from '@/lib/recording/timeouts'
import { isUuid } from '@/lib/practice/session'
import { readAttemptResult } from '@/lib/results/attempt-result'

/** The model call is the slow half. Mechanical metrics take milliseconds. */
export const maxDuration = 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function storedContentStatus(value: unknown): string | null {
  return isRecord(value) && typeof value.status === 'string' ? value.status : null
}

type DatabaseQueryOutcome<T> =
  { status: 'success'; data: T } | { status: 'failure'; error: unknown }

async function readDatabaseQuery<T>(
  load: () => PromiseLike<{ data: T; error: unknown }>,
): Promise<DatabaseQueryOutcome<T>> {
  try {
    const { data, error } = await load()
    return error ? { status: 'failure', error } : { status: 'success', data }
  } catch (error) {
    return { status: 'failure', error }
  }
}

function mechanicalSpans(transcript: string, words: readonly TranscriptWord[]) {
  const tokens = buildTokens(words, transcript)
  const fillers = analyseFillers(tokens, tokens.length)
  return fillers.hits.flatMap((hit) => {
    const selected = hit.token_indices.map((index) => tokens[index]).filter(Boolean)
    const first = selected[0]
    const last = selected.at(-1)
    return first && last
      ? [{ start: first.charStart, end: last.charEnd, text: hit.text, category: hit.category }]
      : []
  })
}

function unreliableSpans(transcript: string, words: readonly TranscriptWord[]) {
  return buildTokens(words, transcript).flatMap((token, index) => {
    const confidence = words[index]?.confidence
    return typeof confidence === 'number' && confidence >= 0 && confidence < 0.75
      ? [{ start: token.charStart, end: token.charEnd, confidence }]
      : []
  })
}

function unavailableProvider(error: unknown): V2ContentDetectorProvider {
  const failure = reportContentProviderFailure(error, 'deepseek', 'configuration_error')
  return {
    name: 'deepseek',
    complete: async () => Promise.reject(failure),
  }
}

export async function POST(request: Request) {
  // Start the shared budget at route entry. Provider work cannot consume the
  // persistence headroom after authentication and database setup have run.
  const workBudget = createWorkBudget(SCORING_WORK_BUDGET_MS)
  const context = await authenticatedAttemptContext()
  if (!context) return apiError('Your session ended. Log in and try again.', 401)
  const { userId, admin } = context

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('The request body was not valid JSON.', 400)
  }

  const attemptId = isRecord(body) && typeof body.attemptId === 'string' ? body.attemptId : ''
  if (!isUuid(attemptId)) return apiError('The attempt id was invalid.', 400)

  const { data: attempt, error: readError } = await admin
    .from('attempts')
    .select(
      'id, prompt_text, audio_path, transcript, duration_ms, metrics, score, section_scores, content_result, practice_mode, rubric_version, status, failure_code, created_at',
    )
    .eq('id', attemptId)
    .eq('user_id', userId)
    .maybeSingle()

  if (readError) {
    logAttemptDiagnostic('load_score_attempt', 'attempt_read_failed', attemptId, readError)
    return apiError('The score could not be computed.', 500)
  }
  if (!attempt) return apiError('That attempt does not exist.', 404)
  if (
    (attempt.status === 'failed' || attempt.status === 'timed_out') &&
    attempt.failure_code === ATTEMPT_FAILURE_CODES.clientUploadAbandoned
  ) {
    return apiError('That recording was not saved and cannot be scored.', 409)
  }

  const storedResultInput = {
    id: attempt.id,
    promptText: attempt.prompt_text,
    transcript: attempt.transcript,
    durationMs: attempt.duration_ms,
    createdAt: attempt.created_at,
    audioUrl: null,
    score: attempt.score,
    sectionScores: attempt.section_scores,
    metrics: attempt.metrics,
    contentResult: attempt.content_result,
  }
  const storedResult = readAttemptResult(storedResultInput)
  const rubricKind = classifyAttemptRubric(attempt.rubric_version)
  const v2Mode = isPracticeMode(attempt.practice_mode) ? attempt.practice_mode : null
  const legacyRecheck = isLegacyRecheckSnapshot({
    ...storedResultInput,
    status: attempt.status,
    rubricVersion: attempt.rubric_version,
  })
  const runV2Assembler = shouldUseV2Assembler(rubricKind, Boolean(v2Mode), legacyRecheck)
  if (rubricKind === 'unsupported' || (rubricKind === 'v2' && !v2Mode && !legacyRecheck)) {
    const isActive = ['uploading', 'transcribing', 'scoring'].includes(attempt.status)
    if (isActive) {
      await markOwnedAttemptFailure(
        admin,
        userId,
        attemptId,
        [attempt.status],
        'failed',
        rubricKind === 'unsupported'
          ? ATTEMPT_FAILURE_CODES.unsupportedRubricVersion
          : ATTEMPT_FAILURE_CODES.scoringInputInvalid,
      )
    }
    return apiError('This attempt uses an unsupported scoring version.', 409)
  }

  // A structurally valid v2 snapshot is immutable. Legacy snapshots remain on
  // the existing path so an explicit "Run the checks" retry can call its
  // content provider again after a prior not_checked result.
  if (shouldReuseStoredV2Score(attempt.section_scores)) {
    return NextResponse.json({
      score: attempt.score,
      section_scores: attempt.section_scores,
      content_status: storedContentStatus(attempt.content_result),
    })
  }

  if (attempt.status === 'done' && !legacyRecheck) {
    return NextResponse.json({
      score: attempt.score,
      section_scores: attempt.section_scores,
      content_status: storedContentStatus(attempt.content_result),
    })
  }
  if (!legacyRecheck && !canRunScoring(attempt.status)) {
    return apiError('That attempt is not ready to be scored.', 409)
  }
  if (attempt.status === 'failed' || attempt.status === 'timed_out') {
    const resumed = await transitionOwnedAttempt(
      admin,
      userId,
      attemptId,
      [attempt.status],
      'scoring',
    )
    if (!resumed) return apiError('That attempt could not resume scoring.', 409)
  }

  const metrics = (attempt.metrics as AttemptMetrics | null) ?? {}
  const capture = metrics.capture
  const transcriptWords = metrics.transcript?.words ?? []
  const transcript = attempt.transcript ?? ''

  if (!capture) {
    if (!legacyRecheck) {
      await markOwnedAttemptFailure(
        admin,
        userId,
        attemptId,
        ['scoring'],
        'failed',
        ATTEMPT_FAILURE_CODES.scoringInputInvalid,
      )
    }
    return apiError('This attempt has no capture data to score.', 400)
  }
  if (transcript.trim().length === 0) {
    if (!legacyRecheck) {
      await markOwnedAttemptFailure(
        admin,
        userId,
        attemptId,
        ['scoring'],
        'failed',
        ATTEMPT_FAILURE_CODES.scoringInputInvalid,
      )
    }
    return apiError('This attempt has no transcript to score.', 400)
  }

  try {
    if (runV2Assembler && v2Mode) {
      const ownedAudio = validateOwnedAttemptAudioPath({
        userId,
        attemptId,
        audioPath: attempt.audio_path,
        metrics,
      })
      if (attempt.audio_path && !ownedAudio) {
        logAttemptDiagnostic(
          'validate_pronunciation_recording_path',
          ATTEMPT_FAILURE_CODES.recordingPathInvalid,
          attemptId,
        )
      }
      const azureConfig = azureSpeechConfig()
      const pronunciationPromise = settleWithinWorkBudget(
        collectPronunciationEvidence({
          config: azureConfig,
          provider: azureConfig ? createAzurePronunciationProvider(azureConfig) : null,
          audioPath: ownedAudio?.storagePath ?? null,
          capture,
          transcript,
          transcriptWords,
          download: (path) => admin.storage.from(RECORDINGS_BUCKET).download(path),
        }),
        workBudget,
        null,
      )
      let provider: V2ContentDetectorProvider
      try {
        provider = contentDetectorFromModel(
          contentModelWithinBudget(createDeepSeekModel(deepseekApiKey()), workBudget),
        )
      } catch (error) {
        provider = unavailableProvider(error)
      }
      const contentPromise = runV2ContentEvaluation({
        provider,
        mode: v2Mode,
        prompt: attempt.prompt_text,
        transcript,
        mechanicallyCounted: mechanicalSpans(transcript, transcriptWords),
        unreliableTranscriptSpans: unreliableSpans(transcript, transcriptWords),
        timeoutMs: SCORING_PROVIDER_TIMEOUT_MS,
      })
      const [pronunciation, content] = await Promise.all([pronunciationPromise, contentPromise])
      const assembled = assembleV2Score({
        mode: v2Mode,
        fluency: evaluateFluency({ capture, words: transcriptWords, transcript }),
        delivery: evaluateDelivery(capture),
        clarity: analyseClarity(transcriptWords, capture, pronunciation, transcript),
        content,
      })
      const nextMetrics = {
        ...metrics,
        v2: {
          score: assembled,
          content,
          scored_at: new Date().toISOString(),
        },
        ...(pronunciation ? { pronunciation } : {}),
      }
      const saved = await transitionOwnedAttempt(admin, userId, attemptId, ['scoring'], 'done', {
        score: assembled.total_earned_points,
        section_scores: JSON.parse(JSON.stringify(assembled)),
        metrics: JSON.parse(JSON.stringify(nextMetrics)),
        content_result: JSON.parse(JSON.stringify(content)),
      })
      if (!saved) {
        const concurrentRead = await readDatabaseQuery(() =>
          admin
            .from('attempts')
            .select('score, section_scores, content_result')
            .eq('id', attemptId)
            .eq('user_id', userId)
            .maybeSingle(),
        )
        if (concurrentRead.status === 'failure') {
          logAttemptDiagnostic(
            'load_concurrent_score',
            'concurrent_score_read_failed',
            attemptId,
            concurrentRead.error,
          )
          return apiError('The score could not be saved.', 500)
        }
        const concurrent = concurrentRead.data
        if (concurrent && shouldReuseStoredV2Score(concurrent.section_scores)) {
          return NextResponse.json({
            score: concurrent.score,
            section_scores: concurrent.section_scores,
            content_status: storedContentStatus(concurrent.content_result),
          })
        }
        await markOwnedAttemptFailure(
          admin,
          userId,
          attemptId,
          ['scoring'],
          'failed',
          ATTEMPT_FAILURE_CODES.scoringPersistenceFailed,
        )
        return apiError('The score could not be saved.', 500)
      }

      return NextResponse.json({
        score: assembled.total_earned_points,
        section_scores: assembled,
        content_status: content.status,
      })
    }

    // Fast, local, and always available.
    const mechanical = computeMechanical(capture, transcriptWords, transcript)
    for (const warning of mechanical.warnings) console.warn('[score]', attemptId, warning)

    const disputeRead = await readDatabaseQuery(() =>
      admin
        .from('note_feedback')
        .select('note_type, quote')
        .eq('attempt_id', attemptId)
        .eq('user_id', userId),
    )
    if (disputeRead.status === 'failure') {
      logAttemptDiagnostic(
        'load_score_disputes',
        'score_disputes_read_failed',
        attemptId,
        disputeRead.error,
      )
      if (!legacyRecheck) {
        await markOwnedAttemptFailure(
          admin,
          userId,
          attemptId,
          ['scoring'],
          'failed',
          ATTEMPT_FAILURE_CODES.scoringUnexpected,
        )
      }
      return apiError('The score could not be computed.', 500)
    }
    const storedDisputes = (disputeRead.data ?? []).map((row) => ({
      note_type: row.note_type,
      quote: row.quote,
    }))
    // New legacy attempts have no stored findings yet, and rechecks may only
    // reuse notes that exactly match the authoritative stored legacy result.
    const disputes =
      storedResult.kind === 'legacy'
        ? validLegacyDisputes(storedResult.attempt.content, storedDisputes)
        : []

    const countedTokens = mechanical.statistics.counted_items.reduce(
      (sum, item) => sum + item.token_indices.length,
      0,
    )

    const userPrompt = buildContentUserPrompt({
      promptText: attempt.prompt_text,
      transcript,
      wordCount: mechanical.statistics.word_count,
      durationSeconds: capture.duration_ms / 1000,
      repeatedPhrases: mechanical.statistics.repeated_phrases,
      targetTightenedWords: Math.max(1, mechanical.statistics.word_count - countedTokens),
      surfacesToDelete: surfacesToDelete(mechanical.statistics.counted_items),
    })

    const {
      model,
      parsed,
      error: contentError,
      tighten,
    } = await runContentCheckSafely({
      createModel: () =>
        contentModelWithinBudget(createDeepSeekModel(deepseekApiKey()), workBudget),
      request: {
        system: CONTENT_SYSTEM_PROMPT,
        user: userPrompt,
        timeoutMs: SCORING_PROVIDER_TIMEOUT_MS,
      },
      transcript,
      countedText: mechanical.statistics.counted_items.map((item) => item.text),
      countedTokens,
      rewriteRequest: ({ previous, mustNotAppear, targetWords }) => ({
        system: REWRITE_SYSTEM_PROMPT,
        user: buildRewriteRetryPrompt({ transcript, previous, mustNotAppear, targetWords }),
        timeoutMs: SCORING_PROVIDER_TIMEOUT_MS,
      }),
    })

    // The rate of under removal, one line per attempt that needed help.
    if (tighten && (tighten.outcome === 'retried' || tighten.outcome === 'stripped')) {
      console.warn('[score] tightened rewrite adjusted', {
        attemptId,
        outcome: tighten.outcome,
        violations: tighten.violations.length,
        removed: tighten.removed.length,
        remaining: tighten.remaining.length,
      })
    }

    const checked = parsed !== null
    const assembled = assembleScore(mechanical, parsed ?? notCheckedContent(), {
      status: checked ? 'checked' : 'not_checked',
      model: checked ? (model?.name ?? null) : null,
      error: checked ? null : contentError,
      disputes,
    })

    const nextMetrics: AttemptMetrics = {
      ...metrics,
      delivery: {
        metrics: mechanical.metrics,
        statistics: mechanical.statistics,
        pauses: mechanical.pauses,
        warnings: mechanical.warnings,
        scored_at: new Date().toISOString(),
        version: SCORE_VERSION,
      },
    }

    const scoreValues = {
      score: assembled.score,
      section_scores: JSON.parse(JSON.stringify(assembled.section_scores)),
      metrics: JSON.parse(JSON.stringify(nextMetrics)),
      content_result: JSON.parse(JSON.stringify(assembled.content_result)),
    }
    let saved = false
    if (legacyRecheck) {
      const { data, error } = await admin
        .from('attempts')
        .update(scoreValues)
        .eq('id', attemptId)
        .eq('user_id', userId)
        .eq('status', 'done')
        .eq('content_result->>status', 'not_checked')
        .select('id')
        .maybeSingle()
      saved = Boolean(data) && !error
      if (error) {
        logAttemptDiagnostic('save_legacy_recheck', 'scoring_persistence_failed', attemptId, error)
      }
    } else {
      saved = await transitionOwnedAttempt(
        admin,
        userId,
        attemptId,
        ['scoring'],
        'done',
        scoreValues,
      )
    }

    if (!saved) {
      if (!legacyRecheck) {
        await markOwnedAttemptFailure(
          admin,
          userId,
          attemptId,
          ['scoring'],
          'failed',
          ATTEMPT_FAILURE_CODES.scoringPersistenceFailed,
        )
      }
      return apiError('The score could not be saved.', 500)
    }

    console.info('[score]', {
      attemptId,
      score: assembled.score,
      delivery: assembled.section_scores.delivery.earned,
      content: assembled.section_scores.content.earned,
      contentStatus: assembled.content_result.status,
      tightened: assembled.content_result.tightened_outcome,
    })

    return NextResponse.json({
      score: assembled.score,
      section_scores: assembled.section_scores,
      content_status: assembled.content_result.status,
    })
  } catch (error) {
    logAttemptDiagnostic('score_attempt', ATTEMPT_FAILURE_CODES.scoringUnexpected, attemptId, error)
    if (!legacyRecheck) {
      await markOwnedAttemptFailure(
        admin,
        userId,
        attemptId,
        ['scoring'],
        'failed',
        ATTEMPT_FAILURE_CODES.scoringUnexpected,
      )
    }
    return apiError('The score could not be computed.', 500)
  }
}
