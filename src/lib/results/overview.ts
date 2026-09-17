import { feedbackSentence } from '@/lib/results/feedback-copy'
import { metricChecks } from '@/lib/results/metric-checks'
import { v3MetricResult } from '@/lib/results/v3'
import { V3_METRIC_LABELS, type V3ScorePayload } from '@/lib/scoring/v3/contracts'

/** Keep the stored metric ranking, but show its actual feedback and next step. */
export function resultOverview(payload: V3ScorePayload): string | null {
  if (payload.total_earned_points === null || !payload.recommendation) return null
  const { strongest_metric: strongest, weakest_metric: weakest } = payload.recommendation
  const strong = metricChecks(strongest, v3MetricResult(payload, strongest), payload.mode)
  const weakResult = v3MetricResult(payload, weakest)
  if (weakResult.component === 1) return strong.summary
  const weak = metricChecks(weakest, weakResult, payload.mode)
  const nextStep = weak.checks
    .filter((check) => check.status === 'deduction' || check.status === 'issue')
    .flatMap((check) => check.findings)
    .find((finding) => finding.suggestion)?.suggestion
  if (nextStep) return `${strong.summary} Try: ${feedbackSentence(nextStep)}`
  return strongest === weakest
    ? strong.summary
    : `${strong.summary} ${V3_METRIC_LABELS[weakest]}: ${weak.summary}`
}
