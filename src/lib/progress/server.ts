import 'server-only'

import {
  aggregateV2Progress,
  type ProgressAggregation,
  type ProgressAggregationOptions,
} from '@/lib/progress/aggregation'
import { readProgressAttemptRows, safeProgressErrorCode } from '@/lib/progress/load'
import { recentRetryComparisons, type ProgressRetryComparison } from '@/lib/progress/retries'
import { createClient } from '@/lib/supabase/server'

/**
 * Maximum completed snapshots included in one dashboard. One extra row is queried
 * as a truncation sentinel so the UI can disclose omitted older responses.
 */
export const PROGRESS_COMPLETED_ATTEMPT_LIMIT = 200

export interface ProgressQueryCoverage {
  completedAttemptLimit: number
  truncated: boolean
}

export interface ProgressDashboardData {
  progress: ProgressAggregation
  retryComparisons: readonly ProgressRetryComparison[]
  coverage: ProgressQueryCoverage
}

export type ProgressDashboardLoadResult =
  | { status: 'ready'; data: ProgressDashboardData }
  | { status: 'failure'; reason: 'query' | 'invalid_response' }

/** User-scoped retrieval seam for the progress server component. */
export async function getProgressDashboardData(
  userId: string,
  options: ProgressAggregationOptions,
): Promise<ProgressDashboardLoadResult> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('attempts')
      .select('id, created_at, section_scores, retry_of_attempt_id, status')
      .eq('user_id', userId)
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PROGRESS_COMPLETED_ATTEMPT_LIMIT + 1)

    const rows = readProgressAttemptRows(data, error !== null, PROGRESS_COMPLETED_ATTEMPT_LIMIT)
    if (rows.status === 'failure') {
      console.error('[progress] attempt load failed', {
        reason: rows.reason,
        code: safeProgressErrorCode(error),
      })
      return rows
    }

    return {
      status: 'ready',
      data: {
        progress: aggregateV2Progress(rows.attempts, options),
        retryComparisons: recentRetryComparisons(rows.attempts, {
          now: options.now,
          mode: options.mode,
        }),
        coverage: {
          completedAttemptLimit: PROGRESS_COMPLETED_ATTEMPT_LIMIT,
          truncated: rows.truncated,
        },
      },
    }
  } catch (error) {
    console.error('[progress] attempt load failed', {
      reason: 'query',
      code: safeProgressErrorCode(error),
    })
    return { status: 'failure', reason: 'query' }
  }
}
