import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import {
  authenticatedAttemptContext,
  logAttemptDiagnostic,
  safeDiagnosticCode,
} from '@/lib/attempts/server'
import { isUuid } from '@/lib/practice/session'
import { readAttemptResult } from '@/lib/results/attempt-result'
import { recomputeScore } from '@/lib/scoring/assemble'
import { resolveLegacyDispute, sameDispute, validLegacyDisputes } from '@/lib/scoring/disputes'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Stores a dispute separately; the authoritative attempt snapshot is never rewritten. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return apiError('That attempt does not exist.', 404)
  const context = await authenticatedAttemptContext()
  if (!context) return apiError('Your session ended. Log in and try again.', 401)
  const { userId, admin } = context

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('The request body was not valid JSON.', 400)
  }

  const noteType = isRecord(body) ? body.noteType : undefined
  const quote = isRecord(body) ? body.quote : undefined

  const { data: attempt, error: readError } = await admin
    .from('attempts')
    .select(
      'id, prompt_text, transcript, duration_ms, created_at, score, section_scores, metrics, content_result',
    )
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) {
    logAttemptDiagnostic('load_dispute_attempt', 'attempt_read_failed', id, readError)
    return apiError('That could not be saved.', 500)
  }
  if (!attempt) return apiError('That attempt does not exist.', 404)

  const storedResult = readAttemptResult({
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
  })
  if (storedResult.kind === 'incomplete') {
    return apiError('That attempt has not been scored yet.', 400)
  }
  if (storedResult.kind !== 'legacy') {
    return apiError('That finding cannot be applied to this result.', 400)
  }

  const resolved = resolveLegacyDispute(storedResult.attempt.content, noteType, quote)
  if (!resolved.ok) {
    return apiError(
      'That finding cannot be disputed. Measurements are counts, not judgements.',
      400,
    )
  }

  const { data: disputeRows, error: disputeError } = await admin
    .from('note_feedback')
    .select('note_type, quote')
    .eq('attempt_id', id)
    .eq('user_id', userId)
  if (disputeError) {
    logAttemptDiagnostic('load_disputes', 'dispute_read_failed', id, disputeError)
    return apiError('That could not be saved.', 500)
  }

  const existing = validLegacyDisputes(
    storedResult.attempt.content,
    (disputeRows ?? []).map((row) => ({ note_type: row.note_type, quote: row.quote })),
  )
  const alreadyStored = existing.some((row) => sameDispute(row, resolved.dispute))
  const disputes = alreadyStored ? existing : [...existing, resolved.dispute]

  let rescored
  try {
    rescored = recomputeScore(
      storedResult.attempt.content,
      storedResult.attempt.sections.delivery.metrics,
      disputes,
    )
  } catch (error) {
    logAttemptDiagnostic('recompute_dispute', 'dispute_result_invalid', id, error)
    return apiError('That finding could not be applied.', 400)
  }

  if (alreadyStored) {
    return NextResponse.json({ score: rescored.score, section_scores: rescored.section_scores })
  }

  const { error: insertError } = await admin.from('note_feedback').insert({
    user_id: userId,
    attempt_id: id,
    note_type: resolved.dispute.note_type,
    quote: resolved.dispute.quote,
  })
  if (insertError) {
    if (safeDiagnosticCode(insertError) === '23505') {
      return NextResponse.json({ score: rescored.score, section_scores: rescored.section_scores })
    }
    logAttemptDiagnostic('save_dispute', 'dispute_insert_failed', id, insertError)
    return apiError('That could not be saved.', 500)
  }

  return NextResponse.json({ score: rescored.score, section_scores: rescored.section_scores })
}
