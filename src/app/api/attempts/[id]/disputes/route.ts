import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { recomputeScore, type StoredContentResult } from '@/lib/scoring/assemble'
import { CHECK_NAMES } from '@/lib/scoring/content'
import type { DeliveryMetricName } from '@/lib/scoring/mechanical'
import { createClient } from '@/lib/supabase/server'

const SPAN_NOTE = 'word_choice_span'
const ALLOWED = new Set<string>([...CHECK_NAMES, SPAN_NOTE])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Records that a user disputes one model finding and rescores without its
 * deduction. Mechanical measurements are counts rather than judgements, so they
 * are not disputable and are carried over untouched.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

  const noteType = isRecord(body) && typeof body.noteType === 'string' ? body.noteType : ''
  const quote = isRecord(body) && typeof body.quote === 'string' ? body.quote : null
  if (!ALLOWED.has(noteType)) {
    return apiError(
      'That finding cannot be disputed. Measurements are counts, not judgements.',
      400,
    )
  }

  const { error: insertError } = await supabase.from('note_feedback').insert({
    user_id: user.id,
    attempt_id: id,
    note_type: noteType,
    quote,
  })
  if (insertError) return apiError(insertError.message, 500)

  const { data: attempt } = await supabase
    .from('attempts')
    .select('content_result, section_scores')
    .eq('id', id)
    .maybeSingle()

  if (!attempt?.content_result || !attempt.section_scores) {
    return apiError('That attempt has not been scored yet.', 400)
  }

  const { data: disputeRows } = await supabase
    .from('note_feedback')
    .select('note_type, quote')
    .eq('attempt_id', id)

  const stored = attempt.content_result as unknown as StoredContentResult
  const sections = attempt.section_scores as unknown as {
    delivery: { metrics: Record<DeliveryMetricName, number> }
  }

  const rescored = recomputeScore(
    stored,
    sections.delivery.metrics,
    (disputeRows ?? []).map((row) => ({ note_type: row.note_type, quote: row.quote })),
  )

  const { error: saveError } = await supabase
    .from('attempts')
    .update({
      score: rescored.score,
      section_scores: JSON.parse(JSON.stringify(rescored.section_scores)),
      content_result: JSON.parse(JSON.stringify(rescored.content_result)),
    })
    .eq('id', id)

  if (saveError) return apiError(`The adjusted score could not be saved: ${saveError.message}`, 500)

  return NextResponse.json({ score: rescored.score, section_scores: rescored.section_scores })
}
