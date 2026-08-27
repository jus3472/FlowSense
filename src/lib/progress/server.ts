import 'server-only'

import {
  aggregateV2Progress,
  type ProgressAggregation,
  type ProgressAggregationOptions,
} from '@/lib/progress/aggregation'
import { readProgressAttemptRows, safeProgressErrorCode } from '@/lib/progress/load'
import { recentRetryComparisons, type ProgressRetryComparison } from '@/lib/progress/retries'
import { createClient } from '@/lib/supabase/server'

export interface ProgressDashboardData {
  progress: ProgressAggregation
  retryComparisons: readonly ProgressRetryComparison[]
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
      .select('id, created_at, section_scores, retry_of_attempt_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    const rows = readProgressAttemptRows(data, error !== null)
    if (rows.status === 'failure') {
      console.error('[progress] attempt load failed', {
        reason: rows.reason,
        code: safeProgressErrorCode(error),
      })
      return rows
    }

    // Task B can add `status = done` here once its lifecycle column is present in
    // the shared database types. Stored snapshots remain the authority meanwhile.
    return {
      status: 'ready',
      data: {
        progress: aggregateV2Progress(rows.attempts, options),
        retryComparisons: recentRetryComparisons(rows.attempts, {
          now: options.now,
          mode: options.mode,
        }),
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
