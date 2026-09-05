import { v3MetricIds, v3MetricResult } from '@/lib/results/v3'
import {
  V3_METRIC_LABELS,
  type V3MetricId,
  type V3ScorePayload,
} from '@/lib/scoring/v3/contracts'

/** A display hint only. It never suppresses numeric stored-result evidence. */
export const RETRY_COMPARISON_NOISE_POINTS = 2
export const MAX_RETRY_CHAIN_LENGTH = 8

export interface RetryComparisonRow {
  category: V3MetricId | 'overall'
  label: string
  currentPoints: number
  previousPoints: number
  maxPoints: number
  deltaPoints: number
  withinNoise: boolean
}

export interface RetryComparison {
  rows: readonly RetryComparisonRow[]
}

export interface RetryChainNode {
  id: string
  retryOfAttemptId: string | null
}

/** Loads a complete, bounded chain and fails closed for invalid links. */
export async function loadRetryAncestorChain<T extends RetryChainNode>(
  startId: string,
  load: (id: string) => Promise<T | null>,
): Promise<readonly T[] | null> {
  if (typeof startId !== 'string' || startId.length === 0) return null
  const ancestors: T[] = []
  const seen = new Set<string>([startId])
  let currentId = startId
  let current = await load(currentId)
  for (let depth = 0; depth <= MAX_RETRY_CHAIN_LENGTH; depth += 1) {
    if (
      !current ||
      typeof current.id !== 'string' ||
      current.id !== currentId ||
      (current.retryOfAttemptId !== null && typeof current.retryOfAttemptId !== 'string')
    )
      return null
    if (current.retryOfAttemptId === null) return ancestors
    if (depth === MAX_RETRY_CHAIN_LENGTH) return null
    if (seen.has(current.retryOfAttemptId)) return null
    seen.add(current.retryOfAttemptId)
    currentId = current.retryOfAttemptId
    current = await load(currentId)
    if (!current || current.id !== currentId) return null
    ancestors.push(current)
  }
  return null
}

/** Compares only exact v3 score/rubric/mode snapshots. */
export function compareV3RetryResults(
  current: V3ScorePayload,
  previous: V3ScorePayload | null,
): RetryComparison | null {
  if (
    !previous ||
    current.version !== previous.version ||
    current.rubric_version !== previous.rubric_version ||
    current.mode !== previous.mode
  ) {
    return null
  }

  const rows: RetryComparisonRow[] = []
  if (current.total_earned_points !== null && previous.total_earned_points !== null) {
    const deltaPoints = current.total_earned_points - previous.total_earned_points
    rows.push({
      category: 'overall',
      label: 'Overall',
      currentPoints: current.total_earned_points,
      previousPoints: previous.total_earned_points,
      maxPoints: 100,
      deltaPoints,
      withinNoise: Math.abs(deltaPoints) <= RETRY_COMPARISON_NOISE_POINTS,
    })
  }

  for (const metric of v3MetricIds(current)) {
    const currentMetric = v3MetricResult(current, metric)
    const previousMetric = v3MetricResult(previous, metric)
    if (
      currentMetric.status !== 'scored' ||
      previousMetric.status !== 'scored' ||
      currentMetric.earned_points === null ||
      previousMetric.earned_points === null ||
      currentMetric.max_points !== previousMetric.max_points
    ) {
      continue
    }
    const deltaPoints = currentMetric.earned_points - previousMetric.earned_points
    rows.push({
      category: metric,
      label: V3_METRIC_LABELS[metric],
      currentPoints: currentMetric.earned_points,
      previousPoints: previousMetric.earned_points,
      maxPoints: currentMetric.max_points,
      deltaPoints,
      withinNoise: Math.abs(deltaPoints) <= RETRY_COMPARISON_NOISE_POINTS,
    })
  }
  return { rows }
}
