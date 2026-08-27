import type { StoredContentResult } from '@/lib/scoring/assemble'
import { CHECK_NAMES, type CheckName, type Dispute } from '@/lib/scoring/content'

export const WORD_CHOICE_SPAN_NOTE = 'word_choice_span'

export type LegacyDisputeResolution =
  | { ok: true; dispute: Dispute }
  | {
      ok: false
      reason: 'invalid_input' | 'not_checked' | 'not_failing' | 'quote_mismatch'
    }

function isCheckName(value: string): value is CheckName {
  return (CHECK_NAMES as readonly string[]).includes(value)
}

/**
 * Resolves a browser request to one currently stored legacy finding. The
 * stored quote is authoritative: a null, changed, or merely similar quote may
 * not release a deduction.
 */
export function resolveLegacyDispute(
  content: StoredContentResult,
  noteType: unknown,
  quote: unknown,
): LegacyDisputeResolution {
  if (typeof noteType !== 'string' || (typeof quote !== 'string' && quote !== null)) {
    return { ok: false, reason: 'invalid_input' }
  }
  if (content.status !== 'checked') return { ok: false, reason: 'not_checked' }

  if (noteType === WORD_CHOICE_SPAN_NOTE) {
    if (typeof quote !== 'string') return { ok: false, reason: 'quote_mismatch' }
    const exactSpan = content.extra_spans.find((span) => span.text === quote)
    return exactSpan
      ? { ok: true, dispute: { note_type: WORD_CHOICE_SPAN_NOTE, quote: exactSpan.text } }
      : { ok: false, reason: 'quote_mismatch' }
  }

  if (!isCheckName(noteType)) return { ok: false, reason: 'invalid_input' }
  const finding = content.checks[noteType]
  if (finding.passed) return { ok: false, reason: 'not_failing' }
  if (quote !== finding.quote) return { ok: false, reason: 'quote_mismatch' }
  return { ok: true, dispute: { note_type: noteType, quote: finding.quote } }
}

export function sameDispute(left: Dispute, right: Dispute): boolean {
  return left.note_type === right.note_type && left.quote === right.quote
}

/** Existing rows can predate the server-only write boundary. Ignore anything
 * that no longer names an exact stored finding and collapse exact duplicates.
 */
export function validLegacyDisputes(
  content: StoredContentResult,
  rows: readonly Dispute[],
): Dispute[] {
  const disputes: Dispute[] = []
  for (const row of rows) {
    const resolved = resolveLegacyDispute(content, row.note_type, row.quote)
    if (!resolved.ok || disputes.some((item) => sameDispute(item, resolved.dispute))) continue
    disputes.push(resolved.dispute)
  }
  return disputes
}
