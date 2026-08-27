import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { authenticatedAttemptContext, logAttemptDiagnostic } from '@/lib/attempts/server'
import { isUuid } from '@/lib/practice/session'
import { recomputeScore, type StoredContentResult } from '@/lib/scoring/assemble'
import { CHECK_NAMES } from '@/lib/scoring/content'
import type { DeliveryMetricName } from '@/lib/scoring/mechanical'

const SPAN_NOTE = 'word_choice_span'
const ALLOWED = new Set<string>([...CHECK_NAMES, SPAN_NOTE])

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

  const noteType = isRecord(body) && typeof body.noteType === 'string' ? body.noteType : ''
  const quote = isRecord(body) && typeof body.quote === 'string' ? body.quote : null
  if (!ALLOWED.has(noteType)) {
    return apiError(
      'That finding cannot be disputed. Measurements are counts, not judgements.',
      400,
    )
  }

  const { data: attempt, error: readError } = await admin
    .from('attempts')
    .select('content_result, section_scores')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) {
    logAttemptDiagnostic('load_dispute_attempt', 'attempt_read_failed', id, readError)
    return apiError('That could not be saved.', 500)
  }
  if (!attempt) return apiError('That attempt does not exist.', 404)
  if (!attempt.content_result || !attempt.section_scores) {
    return apiError('That attempt has not been scored yet.', 400)
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

  let rescored
  try {
    const stored = attempt.content_result as unknown as StoredContentResult
    const sections = attempt.section_scores as unknown as {
      delivery: { metrics: Record<DeliveryMetricName, number> }
    }
    rescored = recomputeScore(stored, sections.delivery.metrics, [
      ...(disputeRows ?? []).map((row) => ({ note_type: row.note_type, quote: row.quote })),
      { note_type: noteType, quote },
    ])
  } catch (error) {
    logAttemptDiagnostic('recompute_dispute', 'dispute_result_invalid', id, error)
    return apiError('That finding could not be applied.', 400)
  }

  const { error: insertError } = await admin.from('note_feedback').insert({
    user_id: userId,
    attempt_id: id,
    note_type: noteType,
    quote,
  })
  if (insertError) {
    logAttemptDiagnostic('save_dispute', 'dispute_insert_failed', id, insertError)
    return apiError('That could not be saved.', 500)
  }

  return NextResponse.json({ score: rescored.score, section_scores: rescored.section_scores })
}
