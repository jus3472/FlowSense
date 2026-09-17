import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { readProgressAttemptRows, safeProgressErrorCode } from '@/lib/progress/load'
import {
  aggregateV3Progress,
  type ProgressAttemptInput,
  type ProgressFilter,
  type V3ProgressAggregation,
} from '@/lib/progress/v3-aggregation'
import { createClient } from '@/lib/supabase/server'
import { applyResponseCategoryFilter } from '@/lib/practice/category-filter'
import { safeTimezone, UTC_TIMEZONE } from '@/lib/timezone'
import type { Database } from '@/lib/types/database'

export const PROGRESS_QUERY_PAGE_SIZE = 500

const PROGRESS_ATTEMPT_COLUMNS =
  'id, finished_at, prompt_text, retry_of_attempt_id, score, section_scores, practice_mode, prompt_source, rubric_version, status, practice_category:metrics->practice->>category'

export interface ProgressDashboardData {
  progress: V3ProgressAggregation
  timezone: string
}

export type ProgressDashboardLoadResult =
  | { status: 'ready'; data: ProgressDashboardData }
  | { status: 'failure'; reason: 'query' | 'invalid_response' }

async function loadProgressAttempts(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date,
  filter: ProgressFilter,
): Promise<
  | { status: 'ready'; attempts: readonly ProgressAttemptInput[] }
  | { status: 'failure'; reason: 'query' | 'invalid_response'; error?: unknown }
> {
  const attempts: ProgressAttemptInput[] = []
  for (let from = 0; ; from += PROGRESS_QUERY_PAGE_SIZE) {
    let query = supabase
      .from('attempts')
      .select(PROGRESS_ATTEMPT_COLUMNS)
      .eq('user_id', userId)
      .eq('status', 'done')
      .eq('rubric_version', 'v3')
      .in('prompt_source', ['library', 'custom'])
      .lte('finished_at', now.toISOString())

    query = applyResponseCategoryFilter(query, filter)

    const { data, error } = await query
      .order('finished_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PROGRESS_QUERY_PAGE_SIZE - 1)
    const page = readProgressAttemptRows(data, error !== null)
    if (page.status === 'failure') return { ...page, error }

    attempts.push(...page.attempts)
    if (page.attempts.length < PROGRESS_QUERY_PAGE_SIZE) break
  }
  return { status: 'ready', attempts }
}

async function loadProgressTimezone(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('timezone')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      console.error('[progress] timezone load failed', {
        code: safeProgressErrorCode(error),
      })
      return UTC_TIMEZONE
    }
    return safeTimezone(data?.timezone)
  } catch (error) {
    console.error('[progress] timezone load failed', {
      code: safeProgressErrorCode(error),
    })
    return UTC_TIMEZONE
  }
}

/** Loads every eligible current result without imposing a product history cap. */
export async function getProgressDashboardData(
  userId: string,
  options: { now: Date; filter?: ProgressFilter },
): Promise<ProgressDashboardLoadResult> {
  try {
    const supabase = await createClient()
    const filter = options.filter ?? 'all'
    const [attemptsResult, timezone] = await Promise.all([
      loadProgressAttempts(supabase, userId, options.now, filter),
      loadProgressTimezone(supabase, userId),
    ])
    if (attemptsResult.status === 'failure') {
      console.error('[progress] attempt load failed', {
        reason: attemptsResult.reason,
        code: safeProgressErrorCode(attemptsResult.error),
      })
      return { status: 'failure', reason: attemptsResult.reason }
    }

    return {
      status: 'ready',
      data: {
        progress: aggregateV3Progress(attemptsResult.attempts, {
          now: options.now,
          filter,
        }),
        timezone,
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
