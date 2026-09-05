import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { recordPracticeActivityDay } from '@/lib/activity/server'
import {
  ATTEMPT_FAILURE_CODES,
  canRunScoring,
} from '@/lib/attempts/lifecycle'
import {
  authenticatedAttemptContext,
  logAttemptDiagnostic,
  markOwnedAttemptFailure,
  transitionOwnedAttempt,
} from '@/lib/attempts/server'
import {
  DEEPSEEK_MODEL,
  createDeepSeekModel,
  reportContentProviderFailure,
} from '@/lib/deepseek/provider'
import { deepseekApiKey } from '@/lib/env/server'
import { contentModelWithinBudget, createWorkBudget } from '@/lib/scoring/work-budget'
import { assembleV3Score, isV3ScorePayload } from '@/lib/scoring/v3/assemble'
import { evaluateAudioMetrics } from '@/lib/scoring/v3/audio'
import { v3AudioMetrics } from '@/lib/scoring/v3/audio-result'
import { v3ContentEvaluatorFromModel } from '@/lib/scoring/v3/content/adapter'
import {
  v3ContentAuditResult,
  type V3ContentEvaluatorProvider,
} from '@/lib/scoring/v3/content/contracts'
import { runV3ContentEvaluation } from '@/lib/scoring/v3/content/evaluate'
import { v3ContentEvidenceInput } from '@/lib/scoring/v3/content/input'
import { PRACTICE_MODES, type PracticeMode } from '@/lib/practice/contracts'
import type { AttemptMetrics } from '@/lib/types/metrics'
import { SCORING_PROVIDER_TIMEOUT_MS, SCORING_WORK_BUDGET_MS } from '@/lib/recording/timeouts'
import { isUuid } from '@/lib/practice/session'

/** The model call is the slow half. Mechanical metrics take milliseconds. */
export const maxDuration = 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function storedContentStatus(value: unknown): string | null {
  return isRecord(value) && typeof value.status === 'string' ? value.status : null
}

function isPracticeMode(value: unknown): value is PracticeMode {
  return typeof value === 'string' && (PRACTICE_MODES as readonly string[]).includes(value)
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

function unavailableV3Provider(error: unknown): V3ContentEvaluatorProvider {
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

  const mode = isPracticeMode(attempt.practice_mode) ? attempt.practice_mode : null
  if (attempt.rubric_version !== 'v3' || !mode) {
    const isActive = ['uploading', 'transcribing', 'scoring'].includes(attempt.status)
    if (isActive) {
      await markOwnedAttemptFailure(
        admin,
        userId,
        attemptId,
        [attempt.status],
        'failed',
        attempt.rubric_version !== 'v3'
          ? ATTEMPT_FAILURE_CODES.unsupportedRubricVersion
          : ATTEMPT_FAILURE_CODES.scoringInputInvalid,
      )
    }
    return apiError('This attempt uses an unsupported scoring version.', 409)
  }

  // A structurally valid current snapshot is immutable.
  if (
    isV3ScorePayload(attempt.section_scores) &&
    attempt.section_scores.mode === mode &&
    attempt.section_scores.total_earned_points === attempt.score
  ) {
    return NextResponse.json({
      score: attempt.score,
      section_scores: attempt.section_scores,
      content_status: storedContentStatus(attempt.content_result),
    })
  }

  if (attempt.status === 'done') {
    return apiError('This attempt uses an unsupported scoring version.', 409)
  }
  if (!canRunScoring(attempt.status)) {
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
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['scoring'],
      'failed',
      ATTEMPT_FAILURE_CODES.scoringInputInvalid,
    )
    return apiError('This attempt has no capture data to score.', 400)
  }
  if (transcript.trim().length === 0) {
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['scoring'],
      'failed',
      ATTEMPT_FAILURE_CODES.scoringInputInvalid,
    )
    return apiError('This attempt has no transcript to score.', 400)
  }

  try {
    {
      let provider: V3ContentEvaluatorProvider
      try {
        provider = v3ContentEvaluatorFromModel(
          contentModelWithinBudget(createDeepSeekModel(deepseekApiKey()), workBudget),
        )
      } catch (error) {
        provider = unavailableV3Provider(error)
      }
      const { mechanicallyOwned, unreliableTranscriptSpans } = v3ContentEvidenceInput(
        transcript,
        transcriptWords,
      )
      const content = await runV3ContentEvaluation({
        provider,
        mode,
        prompt: attempt.prompt_text,
        transcript,
        mechanicallyOwned,
        unreliableTranscriptSpans,
        timeoutMs: SCORING_PROVIDER_TIMEOUT_MS,
        diagnosticAttemptId: attemptId,
      })
      const audio = evaluateAudioMetrics({
        capture,
        words: transcriptWords,
        transcript,
        mode,
      })
      const assembled = assembleV3Score({
        mode,
        content,
        sounded: v3AudioMetrics(audio),
      })
      const contentAudit = v3ContentAuditResult(content, DEEPSEEK_MODEL)
      const saved = await transitionOwnedAttempt(admin, userId, attemptId, ['scoring'], 'done', {
        score: assembled.total_earned_points,
        section_scores: JSON.parse(JSON.stringify(assembled)),
        content_result: JSON.parse(JSON.stringify(contentAudit)),
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
        if (
          concurrent &&
          isV3ScorePayload(concurrent.section_scores) &&
          concurrent.section_scores.mode === mode &&
          concurrent.section_scores.total_earned_points === concurrent.score
        ) {
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

      await recordPracticeActivityDay(admin, userId, {
        status: 'done',
        durationMs: attempt.duration_ms,
        transcript: attempt.transcript,
        score: assembled.total_earned_points,
        sectionScores: assembled,
      })

      return NextResponse.json({
        score: assembled.total_earned_points,
        section_scores: assembled,
        content_status: content.status,
      })
    }
  } catch (error) {
    logAttemptDiagnostic('score_attempt', ATTEMPT_FAILURE_CODES.scoringUnexpected, attemptId, error)
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['scoring'],
      'failed',
      ATTEMPT_FAILURE_CODES.scoringUnexpected,
    )
    return apiError('The score could not be computed.', 500)
  }
}
