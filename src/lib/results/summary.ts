import { CHARGED_PAUSE_MS, FREE_FIRST_WORD_MS } from '@/lib/results/highlights'
import { sameSpan, type CheckFinding, type CheckName, type ExtraSpan } from '@/lib/scoring/content'
import type { DeliveryMetricName, DeliveryStatistics, MetricResult } from '@/lib/scoring/mechanical'
import type { Pause } from '@/lib/scoring/pauses'

export const CHECK_LABEL: Record<CheckName, string> = {
  answered: 'Answered the question',
  explained: 'Explained your reasoning',
  word_choice: 'Word choice',
  logical_order: 'Logical order',
  no_repetition: 'No repetition',
}

export const METRIC_LABEL: Record<DeliveryMetricName, string> = {
  fillers: 'Filler words',
  mid_sentence_pauses: 'Mid-sentence pauses',
  energy: 'Energy',
  pace: 'Pace',
  time_to_first_word: 'Time to first word',
}

/** Trailing zeros off, so 1000ms reads as 1s and 2500ms as 2.5s. */
function seconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(2))}s`
}

/**
 * Plain language, no weights, no percentages, no component values.
 *
 * A raw count sitting beside full points reads as a bug, so a line that shows
 * something countable says what it cost. "4 mid-sentence" next to 14 / 14 was
 * the case that made this necessary: the count was right and the row looked
 * broken. Pace and Energy are left alone, because a rate and a spread carry no
 * implied fault on their own.
 */
export function describeMetric(
  name: DeliveryMetricName,
  metric: MetricResult,
  statistics: DeliveryStatistics,
  pauses: readonly Pause[],
): string {
  const counted = statistics.counted_items.reduce((sum, item) => sum + item.token_indices.length, 0)
  const free = metric.points === metric.max_points
  const settled = (measured: string) => (free ? `${measured}, no points lost` : measured)

  switch (name) {
    case 'fillers': {
      if (counted === 0) return `None in ${statistics.word_count} words`
      return settled(`${counted} per ${statistics.word_count} words`)
    }
    case 'mid_sentence_pauses': {
      const mid = pauses.filter((pause) => pause.kind === 'mid_sentence')
      if (mid.length === 0) return 'No mid-sentence pauses'

      // Only a pause past the threshold carries any burden, so those are the
      // ones named. Naming the total instead contradicts the points beside it.
      const charged = mid.filter((pause) => pause.duration_ms >= CHARGED_PAUSE_MS)
      const threshold = seconds(CHARGED_PAUSE_MS)
      if (charged.length === 0) {
        // Already the whole explanation, so nothing is appended to it.
        return mid.length === 1
          ? `1 mid-sentence, under ${threshold}`
          : `${mid.length} mid-sentence, all under ${threshold}`
      }
      return settled(`${charged.length} mid-sentence over ${threshold}`)
    }
    case 'energy':
      return metric.label === 'Not enough voiced audio'
        ? 'Not enough voiced audio'
        : `${metric.raw.toFixed(1)} semitones, ${metric.label}`
    case 'pace':
      return `${Math.round(metric.raw)} words per minute`
    case 'time_to_first_word': {
      const measured = `${metric.raw.toFixed(1)}s of silence first`
      return metric.raw * 1000 <= FREE_FIRST_WORD_MS
        ? `${measured}, under ${seconds(FREE_FIRST_WORD_MS)}`
        : settled(measured)
    }
  }
}

/**
 * The spans to show under their own heading, which is every flagged span that is
 * not already on screen as the Word choice quote. A span shown twice reads as
 * two findings and offers two ways to dispute one thing.
 */
export function listedSpans(
  spans: readonly ExtraSpan[],
  wordChoice: CheckFinding,
): readonly ExtraSpan[] {
  const quoted = wordChoice.passed ? null : wordChoice.quote
  if (!quoted) return spans
  return spans.filter((span) => !sameSpan(span.text, quoted))
}

export interface Deduction {
  label: string
  lost: number
}

/**
 * The single biggest loss across both halves, for the one line read on home and
 * in history. Names what cost the most without ranking the response.
 */
export function largestDeduction(
  metrics: Record<DeliveryMetricName, MetricResult>,
  checkPoints: Record<CheckName, number> | null,
  checkMaxima: Record<CheckName, number>,
): Deduction | null {
  const losses: Deduction[] = []

  for (const [name, metric] of Object.entries(metrics) as Array<
    [DeliveryMetricName, MetricResult]
  >) {
    const lost = metric.max_points - metric.points
    if (lost > 0) losses.push({ label: METRIC_LABEL[name], lost })
  }

  if (checkPoints) {
    for (const [name, points] of Object.entries(checkPoints) as Array<[CheckName, number]>) {
      const lost = (checkMaxima[name] ?? 0) - points
      if (lost > 0) losses.push({ label: CHECK_LABEL[name], lost })
    }
  }

  if (losses.length === 0) return null
  return losses.sort((a, b) => b.lost - a.lost)[0] ?? null
}

/** "Your last response scored 59. Filler words cost the most." */
export function summariseAttempt(score: number, deduction: Deduction | null): string {
  if (!deduction) return `Your last response scored ${score}. Nothing cost points.`
  return `Your last response scored ${score}. ${deduction.label} cost the most.`
}

export function deductionLine(deduction: Deduction | null): string {
  return deduction ? `${deduction.label} cost the most` : 'Nothing cost points'
}
