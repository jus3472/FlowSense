import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { HistoryEntry, HistoryMetadataFilter, HistoryQuery } from '@/lib/results/history'
import type { Database } from '@/lib/types/database'

export const HISTORY_PAGE_SIZE = 20
export const HISTORY_SCORE_SCAN_SIZE = 200

export interface HistoryPageData {
  entries: HistoryEntry[]
  hasAnyEntries: boolean
  hasNext: boolean
  hasPrevious: boolean
}

export type HistoryPageResult =
  | { status: 'ready'; data: HistoryPageData }
  | { status: 'failure'; operation: 'existence' | 'score_average' | 'page'; error: unknown }

function applyMetadataFilter<T>(query: T, metadata: HistoryMetadataFilter): T {
  const filter = query as T & {
    eq(column: string, value: string): T
    not(column: string, operator: string, value: null): T
    or(filters: string): T
  }
  if (metadata === 'general') return filter.or('practice_mode.eq.practice,practice_mode.is.null')
  if (metadata === 'interview' || metadata === 'presentation' || metadata === 'conversation')
    return filter.eq('practice_mode', metadata)
  if (metadata === 'custom') return filter.eq('prompt_source', 'custom')
  if (metadata === 'retry') return filter.not('retry_of_attempt_id', 'is', null)
  return query
}

async function loadFilteredScoreAverage(
  supabase: SupabaseClient<Database>,
  userId: string,
  metadata: HistoryMetadataFilter,
): Promise<{ status: 'ready'; average: number | null } | { status: 'failure'; error: unknown }> {
  let offset = 0
  let count = 0
  let total = 0
  while (true) {
    let batchQuery = supabase
      .from('attempts')
      .select('score')
      .eq('user_id', userId)
      .not('score', 'is', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + HISTORY_SCORE_SCAN_SIZE - 1)
    batchQuery = applyMetadataFilter(batchQuery, metadata)
    const { data, error } = await batchQuery
    if (error) return { status: 'failure', error }
    const scores = (data ?? [])
      .map((row) => row.score)
      .filter((score): score is number => score !== null)
    total += scores.reduce((sum, score) => sum + score, 0)
    count += scores.length
    if ((data?.length ?? 0) < HISTORY_SCORE_SCAN_SIZE) break
    offset += HISTORY_SCORE_SCAN_SIZE
  }
  return { status: 'ready', average: count > 0 ? total / count : null }
}

export async function loadHistoryPage(
  supabase: SupabaseClient<Database>,
  userId: string,
  historyQuery: HistoryQuery,
): Promise<HistoryPageResult> {
  const existencePromise = supabase
    .from('attempts')
    .select('id')
    .eq('user_id', userId)
    .or('score.not.is.null,section_scores.not.is.null')
    .limit(1)

  const averageResult =
    historyQuery.score === 'all'
      ? ({ status: 'ready', average: null } as const)
      : await loadFilteredScoreAverage(supabase, userId, historyQuery.metadata)
  if (averageResult.status === 'failure')
    return { status: 'failure', operation: 'score_average', error: averageResult.error }

  const offset = (historyQuery.page - 1) * HISTORY_PAGE_SIZE
  let pageQuery = supabase
    .from('attempts')
    .select(
      'id, created_at, prompt_text, score, section_scores, practice_mode, prompt_source, retry_of_attempt_id',
    )
    .eq('user_id', userId)
    .or('score.not.is.null,section_scores.not.is.null')
  pageQuery = applyMetadataFilter(pageQuery, historyQuery.metadata)
  if (historyQuery.score !== 'all') {
    if (averageResult.average === null) {
      const { data: existenceData, error: existenceError } = await existencePromise
      if (existenceError)
        return { status: 'failure', operation: 'existence', error: existenceError }
      return {
        status: 'ready',
        data: {
          entries: [],
          hasAnyEntries: (existenceData?.length ?? 0) > 0,
          hasNext: false,
          hasPrevious: historyQuery.page > 1,
        },
      }
    }
    pageQuery =
      historyQuery.score === 'high'
        ? pageQuery.gte('score', averageResult.average)
        : pageQuery.lt('score', averageResult.average)
  }
  const pagePromise = pageQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + HISTORY_PAGE_SIZE)

  const [existenceResult, pageResult] = await Promise.all([existencePromise, pagePromise])
  if (existenceResult.error)
    return { status: 'failure', operation: 'existence', error: existenceResult.error }
  if (pageResult.error) return { status: 'failure', operation: 'page', error: pageResult.error }

  const rows = pageResult.data ?? []
  return {
    status: 'ready',
    data: {
      entries: rows.slice(0, HISTORY_PAGE_SIZE).map((attempt) => ({
        id: attempt.id,
        createdAt: attempt.created_at,
        promptText: attempt.prompt_text,
        score: attempt.score,
        practiceMode: attempt.practice_mode,
        promptSource: attempt.prompt_source,
        retryOfAttemptId: attempt.retry_of_attempt_id,
      })),
      hasAnyEntries: (existenceResult.data?.length ?? 0) > 0,
      hasNext: rows.length > HISTORY_PAGE_SIZE,
      hasPrevious: historyQuery.page > 1,
    },
  }
}
