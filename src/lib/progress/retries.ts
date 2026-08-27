import type { PracticeMode } from '@/lib/practice/contracts'
import { RECENT_PROGRESS_WINDOW_DAYS } from '@/lib/progress/aggregation'
import {
  compareRetryResults,
  type RetryComparison,
  type RetryComparisonRow,
} from '@/lib/results/retry-comparison'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'

export interface ProgressRetryAttemptInput {
  id: string
  createdAt: string
  retryOfAttemptId: string | null
  sectionScores: unknown
}

export interface ProgressRetryComparison {
  attemptId: string
  parentAttemptId: string
  createdAt: string
  comparison: RetryComparison
}

export interface ProgressRetryOptions {
  now: Date
  mode?: PracticeMode
  limit?: number
}

/**
 * Reads only compatible stored snapshots. A parent can be older than the
 * recent window, but the retry itself must be recent and complete enough to
 * produce at least one numeric comparison row.
 */
export function recentRetryComparisons(
  input: readonly ProgressRetryAttemptInput[],
  options: ProgressRetryOptions,
): ProgressRetryComparison[] {
  const now = options.now.getTime()
  if (!Number.isFinite(now)) throw new Error('Retry progress requires a valid current time.')

  const recentStart = now - RECENT_PROGRESS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const byId = new Map(input.map((attempt) => [attempt.id, attempt]))
  const comparisons: ProgressRetryComparison[] = []

  for (const attempt of input) {
    const createdAt = Date.parse(attempt.createdAt)
    const current = decodeStoredSectionSnapshot(attempt.sectionScores)
    if (
      !attempt.retryOfAttemptId ||
      attempt.retryOfAttemptId === attempt.id ||
      !Number.isFinite(createdAt) ||
      createdAt < recentStart ||
      createdAt > now ||
      current.kind !== 'v2' ||
      (options.mode && current.payload.mode !== options.mode)
    ) {
      continue
    }

    const parent = byId.get(attempt.retryOfAttemptId)
    if (!parent) continue
    const previous = decodeStoredSectionSnapshot(parent.sectionScores)
    if (previous.kind !== 'v2') continue
    const comparison = compareRetryResults(current.payload, previous.payload)
    if (!comparison || comparison.rows.length === 0) continue

    comparisons.push({
      attemptId: attempt.id,
      parentAttemptId: parent.id,
      createdAt: attempt.createdAt,
      comparison,
    })
  }

  const limit = Math.max(0, Math.min(options.limit ?? 3, 10))
  return comparisons
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.attemptId.localeCompare(right.attemptId),
    )
    .slice(0, limit)
}

export function retryDifferenceLabel(row: RetryComparisonRow): string {
  if (row.withinNoise) return 'Small score difference'
  if (row.deltaPoints > 0) return `Up ${row.deltaPoints}`
  if (row.deltaPoints < 0) return `Down ${Math.abs(row.deltaPoints)}`
  return 'No score difference'
}
