import 'server-only'

import {
  aggregateV2Progress,
  type ProgressAggregation,
  type ProgressAggregationOptions,
} from '@/lib/progress/aggregation'
import { createClient } from '@/lib/supabase/server'

/** Server-only retrieval seam for a future progress route or server component. */
export async function getV2Progress(
  options: ProgressAggregationOptions,
): Promise<ProgressAggregation> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('attempts')
    .select('id, created_at, section_scores')
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Progress attempts could not be loaded: ${error.message}`)
  return aggregateV2Progress(
    (data ?? []).map((attempt) => ({
      id: attempt.id,
      createdAt: attempt.created_at,
      sectionScores: attempt.section_scores,
    })),
    options,
  )
}
