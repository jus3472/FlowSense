import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { createDeepSeekModel } from '@/lib/deepseek/provider'
import {
  CONTENT_SYSTEM_PROMPT,
  REWRITE_SYSTEM_PROMPT,
  buildContentUserPrompt,
  buildRewriteRetryPrompt,
} from '@/lib/deepseek/prompt'
import { deepseekApiKey } from '@/lib/env/server'
import { SCORE_VERSION, assembleScore } from '@/lib/scoring/assemble'
import { notCheckedContent, type Dispute } from '@/lib/scoring/content'
import { runContentCheck } from '@/lib/scoring/run-content'
import { computeMechanical } from '@/lib/scoring/mechanical'
import { surfacesToDelete } from '@/lib/scoring/tighten'
import { analyseFillers } from '@/lib/scoring/fillers'
import { buildTokens } from '@/lib/scoring/tokens'
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
import { createClient } from '@/lib/supabase/server'
import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { AttemptMetrics } from '@/lib/types/metrics'

/** The model call is the slow half. Mechanical metrics take milliseconds. */
export const maxDuration = 60

const MODEL_TIMEOUT_MS = 30_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function storedContentStatus(value: unknown): string | null {
  return isRecord(value) && typeof value.status === 'string' ? value.status : null
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
  const message = error instanceof Error ? error.message : 'Content provider failed.'
  return { name: 'deepseek', complete: async () => Promise.reject(new Error(message)) }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError('Your session ended. Log in and try again.', 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('The request body was not valid JSON.', 400)
  }

  const attemptId = isRecord(body) && typeof body.attemptId === 'string' ? body.attemptId : ''
  if (!attemptId) return apiError('The attempt id was missing.', 400)

  const { data: attempt, error: readError } = await supabase
    .from('attempts')
    .select(
      'id, prompt_text, transcript, duration_ms, metrics, score, section_scores, content_result, practice_mode, rubric_version',
    )
    .eq('id', attemptId)
    .maybeSingle()

  if (readError) return apiError(readError.message, 500)
  if (!attempt) return apiError('That attempt does not exist.', 404)

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

  const metrics = (attempt.metrics as AttemptMetrics | null) ?? {}
  const capture = metrics.capture
  const transcriptWords = metrics.transcript?.words ?? []
  const transcript = attempt.transcript ?? ''

  if (!capture) return apiError('This attempt has no capture data to score.', 400)
  if (transcript.trim().length === 0) {
    return apiError('This attempt has no transcript to score.', 400)
  }

  if (attempt.rubric_version === 'v2' && isPracticeMode(attempt.practice_mode)) {
    let provider: V2ContentDetectorProvider
    try {
      provider = contentDetectorFromModel(createDeepSeekModel(deepseekApiKey()))
    } catch (error) {
      provider = unavailableProvider(error)
    }
    const content = await runV2ContentEvaluation({
      provider,
      mode: attempt.practice_mode,
      prompt: attempt.prompt_text,
      transcript,
      mechanicallyCounted: mechanicalSpans(transcript, transcriptWords),
      unreliableTranscriptSpans: unreliableSpans(transcript, transcriptWords),
      timeoutMs: MODEL_TIMEOUT_MS,
    })
    const assembled = assembleV2Score({
      mode: attempt.practice_mode,
      fluency: evaluateFluency({ capture, words: transcriptWords, transcript }),
      delivery: evaluateDelivery(capture),
      clarity: analyseClarity(transcriptWords, capture),
      content,
    })
    const nextMetrics = {
      ...metrics,
      v2: {
        score: assembled,
        content,
        scored_at: new Date().toISOString(),
      },
    }
    const { error: saveError } = await supabase
      .from('attempts')
      .update({
        score: assembled.total_earned_points,
        section_scores: JSON.parse(JSON.stringify(assembled)),
        metrics: JSON.parse(JSON.stringify(nextMetrics)),
        content_result: JSON.parse(JSON.stringify(content)),
      })
      .eq('id', attemptId)
    if (saveError) return apiError(`The score could not be saved: ${saveError.message}`, 500)

    return NextResponse.json({
      score: assembled.total_earned_points,
      section_scores: assembled,
      content_status: content.status,
    })
  }

  // Fast, local, and always available.
  const mechanical = computeMechanical(capture, transcriptWords, transcript)
  for (const warning of mechanical.warnings) console.warn('[score]', attemptId, warning)

  const { data: disputeRows } = await supabase
    .from('note_feedback')
    .select('note_type, quote')
    .eq('attempt_id', attemptId)
  const disputes: Dispute[] = (disputeRows ?? []).map((row) => ({
    note_type: row.note_type,
    quote: row.quote,
  }))

  const countedTokens = mechanical.statistics.counted_items.reduce(
    (sum, item) => sum + item.token_indices.length,
    0,
  )

  const model = createDeepSeekModel(deepseekApiKey())
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
    parsed,
    error: contentError,
    tighten,
  } = await runContentCheck({
    model,
    request: { system: CONTENT_SYSTEM_PROMPT, user: userPrompt, timeoutMs: MODEL_TIMEOUT_MS },
    transcript,
    countedText: mechanical.statistics.counted_items.map((item) => item.text),
    countedTokens,
    rewriteRequest: ({ previous, mustNotAppear, targetWords }) => ({
      system: REWRITE_SYSTEM_PROMPT,
      user: buildRewriteRetryPrompt({ transcript, previous, mustNotAppear, targetWords }),
      timeoutMs: MODEL_TIMEOUT_MS,
    }),
  })
  if (contentError) console.warn('[score]', attemptId, 'content check failed:', contentError)

  // The rate of under removal, one line per attempt that needed help.
  if (tighten && (tighten.outcome === 'retried' || tighten.outcome === 'stripped')) {
    console.warn('[score]', attemptId, `tightened rewrite ${tighten.outcome}`, {
      leftIn: tighten.violations,
      removedByHand: tighten.removed,
      stillThere: tighten.remaining,
    })
  }

  const checked = parsed !== null
  const assembled = assembleScore(mechanical, parsed ?? notCheckedContent(), {
    status: checked ? 'checked' : 'not_checked',
    model: checked ? model.name : null,
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

  const { error: saveError } = await supabase
    .from('attempts')
    .update({
      score: assembled.score,
      section_scores: JSON.parse(JSON.stringify(assembled.section_scores)),
      metrics: JSON.parse(JSON.stringify(nextMetrics)),
      content_result: JSON.parse(JSON.stringify(assembled.content_result)),
    })
    .eq('id', attemptId)

  if (saveError) return apiError(`The score could not be saved: ${saveError.message}`, 500)

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
}
