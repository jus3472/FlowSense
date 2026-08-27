import 'server-only'

import {
  aggregateV2Progress,
  type ProgressAggregation,
  type ProgressAggregationOptions,
} from '@/lib/progress/aggregation'
import { recentRetryComparisons, type ProgressRetryComparison } from '@/lib/progress/retries'
import { createClient } from '@/lib/supabase/server'

export interface ProgressDashboardData {
  progress: ProgressAggregation
  retryComparisons: readonly ProgressRetryComparison[]
}

/** User-scoped retrieval seam for the progress server component. */
export async function getProgressDashboardData(
  options: ProgressAggregationOptions,
): Promise<ProgressDashboardData> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Your session ended. Log in and try again.')
  const { data, error } = await supabase
    .from('attempts')
    .select('id, created_at, section_scores, retry_of_attempt_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Progress attempts could not be loaded: ${error.message}`)
  const attempts = (data ?? []).map((attempt) => ({
    id: attempt.id,
    createdAt: attempt.created_at,
    retryOfAttemptId: attempt.retry_of_attempt_id,
    sectionScores: attempt.section_scores,
  }))
  return {
    progress: aggregateV2Progress(attempts, options),
    retryComparisons: recentRetryComparisons(attempts, {
      now: options.now,
      mode: options.mode,
    }),
  }
}
