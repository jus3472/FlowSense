import {
  CONTENT_POINTS,
  applyDisputes,
  scoreContent,
  type CheckFinding,
  type CheckName,
  type ExtraSpan,
  type ParsedContent,
} from '@/lib/scoring/content'
import {
  DELIVERY_POINTS,
  type DeliveryMetricName,
  type MechanicalResult,
} from '@/lib/scoring/mechanical'
import type { TightenOutcome } from '@/lib/scoring/tighten'

export const SCORE_VERSION = 1

export const CONTENT_MAX = Object.values(CONTENT_POINTS).reduce((sum, value) => sum + value, 0)
export const DELIVERY_MAX = Object.values(DELIVERY_POINTS).reduce((sum, value) => sum + value, 0)

export interface StoredContentResult {
  status: 'checked' | 'not_checked'
  model: string | null
  error: string | null
  checks: Record<CheckName, CheckFinding>
  extra_spans: ExtraSpan[]
  tightened: string | null
  /** clean, retried, or stripped: what it took to get the padding out of it. */
  tightened_outcome: TightenOutcome
  /** What validation discarded, so a bad response can be traced. */
  dropped: string[]
  points: Record<CheckName, number>
  disputes_applied: number
}

export interface SectionScores {
  content: { earned: number; max: number; checks: Record<CheckName, number> }
  delivery: { earned: number; max: number; metrics: Record<DeliveryMetricName, number> }
}

export interface AssembledScore {
  score: number
  section_scores: SectionScores
  content_result: StoredContentResult
}

/**
 * Combines the two halves. The subtotals are built from the same numbers that
 * are stored, so the sections always add up to the score exactly.
 */
export function assembleScore(
  mechanical: MechanicalResult,
  content: ParsedContent,
  meta: {
    status: 'checked' | 'not_checked'
    model: string | null
    error: string | null
    disputes?: readonly { note_type: string; quote: string | null }[]
  },
): AssembledScore {
  const disputes = meta.disputes ?? []
  const contentScore = scoreContent(applyDisputes(content, disputes))

  const deliveryMetrics = Object.fromEntries(
    Object.entries(mechanical.metrics).map(([name, metric]) => [name, metric.points]),
  ) as Record<DeliveryMetricName, number>

  const deliveryEarned = Object.values(deliveryMetrics).reduce((sum, value) => sum + value, 0)

  return {
    score: contentScore.total + deliveryEarned,
    section_scores: {
      content: { earned: contentScore.total, max: CONTENT_MAX, checks: contentScore.points },
      delivery: { earned: deliveryEarned, max: DELIVERY_MAX, metrics: deliveryMetrics },
    },
    content_result: {
      status: meta.status,
      model: meta.model,
      error: meta.error,
      checks: content.checks,
      extra_spans: content.extra_spans,
      tightened: content.tightened,
      tightened_outcome: content.tightened_outcome,
      dropped: content.dropped,
      points: contentScore.points,
      disputes_applied: disputes.length,
    },
  }
}

/**
 * Rescoring after a dispute. The mechanical half never changes, because counts
 * are not judgements and are not disputable, so only the stored model findings
 * are re-run through the deductions.
 */
export function recomputeScore(
  stored: StoredContentResult,
  deliveryMetrics: Record<DeliveryMetricName, number>,
  disputes: readonly { note_type: string; quote: string | null }[],
): AssembledScore {
  const original = {
    checks: stored.checks,
    extra_spans: stored.extra_spans,
    tightened: stored.tightened,
    // Rows scored before the rewrite was enforced have no outcome recorded.
    tightened_outcome: stored.tightened_outcome ?? 'none',
    dropped: stored.dropped,
  }
  const contentScore = scoreContent(applyDisputes(original, disputes))
  const deliveryEarned = Object.values(deliveryMetrics).reduce((sum, value) => sum + value, 0)

  return {
    score: contentScore.total + deliveryEarned,
    section_scores: {
      content: { earned: contentScore.total, max: CONTENT_MAX, checks: contentScore.points },
      delivery: { earned: deliveryEarned, max: DELIVERY_MAX, metrics: deliveryMetrics },
    },
    content_result: {
      ...stored,
      // The original findings are kept. Only the points move.
      points: contentScore.points,
      disputes_applied: disputes.length,
    },
  }
}
