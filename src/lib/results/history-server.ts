import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readHistoryStoredResult,
  summarizeHistoryScoreCohort,
  type HistoryScoreSummary,
} from '@/lib/results/history-cohort'
import type { HistoryEntry, HistoryMetadataFilter, HistoryQuery } from '@/lib/results/history'
import type { AttemptRow, Database } from '@/lib/types/database'

export const HISTORY_PAGE_SIZE = 20
export const HISTORY_SCORE_SCAN_SIZE = 200

type HistoryAttemptRow = Pick<
  AttemptRow,
  | 'id'
  | 'created_at'
  | 'prompt_text'
  | 'score'
  | 'section_scores'
  | 'practice_mode'
  | 'prompt_source'
  | 'retry_of_attempt_id'
>

export interface HistoryPageData {
  entries: HistoryEntry[]
  scoreSummary: HistoryScoreSummary
  hasAnyEntries: boolean
  hasNext: boolean
  hasPrevious: boolean
}

export type HistoryPageResult =
  | { status: 'ready'; data: HistoryPageData }
  | { status: 'failure'; operation: 'existence' | 'score_cohort' | 'page'; error: unknown }

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

function historyEntry(row: HistoryAttemptRow): HistoryEntry {
  const stored = readHistoryStoredResult(row.section_scores, row.score)
  return {
    id: row.id,
    createdAt: row.created_at,
    promptText: row.prompt_text,
    score: stored.score,
    resultKind: stored.kind,
    practiceMode: row.practice_mode,
    promptSource: row.prompt_source,
    retryOfAttemptId: row.retry_of_attempt_id,
  }
}

function scoreSummary(rows: readonly HistoryAttemptRow[], truncated: boolean) {
  return summarizeHistoryScoreCohort(
    rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      score: row.score,
      sectionScores: row.section_scores,
      practiceMode: row.practice_mode,
    })),
    { scanLimit: HISTORY_SCORE_SCAN_SIZE, truncated },
  )
}

function pageFromCohort(
  rows: readonly HistoryAttemptRow[],
  summary: HistoryScoreSummary,
  query: HistoryQuery,
): { entries: HistoryEntry[]; hasNext: boolean } {
  if (summary.average === null) return { entries: [], hasNext: false }
  const average = summary.average
  const values = new Map(summary.points.map((point) => [point.attemptId, point.value]))
  const filtered = rows.filter((row) => {
    const value = values.get(row.id)
    if (value === undefined) return false
    return query.score === 'high' ? value >= average : value < average
  })
  const offset = (query.page - 1) * HISTORY_PAGE_SIZE
  return {
    entries: filtered.slice(offset, offset + HISTORY_PAGE_SIZE).map(historyEntry),
    hasNext: filtered.length > offset + HISTORY_PAGE_SIZE,
  }
}

/** Returns only a bounded diagnostic code, never database text or row contents. */
export function safeHistoryErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return undefined
  const code = (error as Record<string, unknown>).code
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code) ? code : undefined
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
    .eq('status', 'done')
    .limit(1)

  let cohortQuery = supabase
    .from('attempts')
    .select(
      'id, created_at, prompt_text, score, section_scores, practice_mode, prompt_source, retry_of_attempt_id',
    )
    .eq('user_id', userId)
    .eq('status', 'done')
  cohortQuery = applyMetadataFilter(cohortQuery, historyQuery.metadata)
  const cohortPromise = cohortQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, HISTORY_SCORE_SCAN_SIZE)

  const [existenceResult, cohortResult] = await Promise.all([existencePromise, cohortPromise])
  if (existenceResult.error)
    return { status: 'failure', operation: 'existence', error: existenceResult.error }
  if (cohortResult.error)
    return { status: 'failure', operation: 'score_cohort', error: cohortResult.error }

  const scannedRows = (cohortResult.data ?? []).slice(0, HISTORY_SCORE_SCAN_SIZE)
  const summary = scoreSummary(
    scannedRows,
    (cohortResult.data?.length ?? 0) > HISTORY_SCORE_SCAN_SIZE,
  )

  if (historyQuery.score !== 'all') {
    const page = pageFromCohort(scannedRows, summary, historyQuery)
    return {
      status: 'ready',
      data: {
        entries: page.entries,
        scoreSummary: summary,
        hasAnyEntries: (existenceResult.data?.length ?? 0) > 0,
        hasNext: page.hasNext,
        hasPrevious: historyQuery.page > 1,
      },
    }
  }

  const offset = (historyQuery.page - 1) * HISTORY_PAGE_SIZE
  let pageQuery = supabase
    .from('attempts')
    .select(
      'id, created_at, prompt_text, score, section_scores, practice_mode, prompt_source, retry_of_attempt_id',
    )
    .eq('user_id', userId)
    .eq('status', 'done')
  pageQuery = applyMetadataFilter(pageQuery, historyQuery.metadata)
  const pageResult = await pageQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + HISTORY_PAGE_SIZE)
  if (pageResult.error) return { status: 'failure', operation: 'page', error: pageResult.error }

  const rows = pageResult.data ?? []
  return {
    status: 'ready',
    data: {
      entries: rows.slice(0, HISTORY_PAGE_SIZE).map(historyEntry),
      scoreSummary: summary,
      hasAnyEntries: (existenceResult.data?.length ?? 0) > 0,
      hasNext: rows.length > HISTORY_PAGE_SIZE,
      hasPrevious: historyQuery.page > 1,
    },
  }
}
