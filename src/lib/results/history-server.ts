import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileCurrentUserStaleAttempts } from '@/lib/attempts/reconciliation'
import {
  CHAPTER_LEVELS,
  PATH_SLUGS,
  type ChapterLevel,
  type PathSlug,
} from '@/lib/curriculum/contracts'
import { isPassingScore, starsForScore } from '@/lib/curriculum/thresholds'
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
  | 'status'
  | 'failure_code'
  | 'lesson_id'
>

type HistoryPageRow = HistoryAttemptRow & { lesson: unknown }

type HistoryScoreRow = Pick<
  AttemptRow,
  'id' | 'created_at' | 'score' | 'section_scores' | 'practice_mode'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function historyPageRow(value: unknown): HistoryPageRow | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.created_at !== 'string' ||
    typeof value.prompt_text !== 'string' ||
    !finiteNumberOrNull(value.score) ||
    (value.practice_mode !== null &&
      !['practice', 'interview', 'presentation', 'conversation'].includes(
        String(value.practice_mode),
      )) ||
    (value.prompt_source !== null &&
      value.prompt_source !== 'library' &&
      value.prompt_source !== 'custom') ||
    (value.retry_of_attempt_id !== null && typeof value.retry_of_attempt_id !== 'string') ||
    !['done', 'failed', 'timed_out'].includes(String(value.status)) ||
    (value.failure_code !== null && typeof value.failure_code !== 'string') ||
    (value.lesson_id !== null && typeof value.lesson_id !== 'string')
  ) {
    return null
  }
  return value as HistoryPageRow
}

function parseLessonContext(value: unknown) {
  if (!isRecord(value) || !isRecord(value.chapter)) return null
  const chapter = value.chapter
  const path: unknown = chapter.path
  if (!isRecord(path)) return null
  if (
    typeof value.title !== 'string' ||
    !Number.isInteger(value.position) ||
    typeof value.checkpoint !== 'boolean' ||
    typeof chapter.title !== 'string' ||
    !CHAPTER_LEVELS.includes(chapter.level as ChapterLevel) ||
    typeof path.title !== 'string' ||
    !PATH_SLUGS.includes(path.slug as PathSlug)
  ) {
    return null
  }
  return {
    pathSlug: path.slug as PathSlug,
    pathTitle: path.title,
    chapterLevel: chapter.level as ChapterLevel,
    chapterTitle: chapter.title,
    lessonTitle: value.title,
    lessonPosition: value.position as number,
    checkpoint: value.checkpoint,
  }
}

function historyEntry(row: HistoryPageRow): HistoryEntry | null {
  const stored =
    row.status === 'done'
      ? readHistoryStoredResult(row.section_scores, row.score)
      : { score: null, kind: undefined }
  const terminalStatus =
    row.status === 'done' || row.status === 'failed' || row.status === 'timed_out'
      ? row.status
      : undefined
  const lesson = row.lesson_id === null ? null : parseLessonContext(row.lesson)
  if (row.lesson_id !== null && lesson === null) return null
  return {
    id: row.id,
    createdAt: row.created_at,
    promptText: row.prompt_text,
    score: stored.score,
    resultKind: stored.kind,
    practiceMode: row.practice_mode,
    promptSource: row.prompt_source,
    retryOfAttemptId: row.retry_of_attempt_id,
    ...(terminalStatus ? { status: terminalStatus } : {}),
    failureCode: row.failure_code,
    ...(lesson
      ? {
          lesson: {
            ...lesson,
            stars: starsForScore(stored.score),
            outcome:
              stored.score === null
                ? ('neutral' as const)
                : isPassingScore(stored.score)
                  ? ('passed' as const)
                  : ('not_passed' as const),
          },
        }
      : {}),
  }
}

function scoreSummary(rows: readonly HistoryScoreRow[], truncated: boolean) {
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
  // Close old active rows before the terminal-only queries so abandoned work
  // becomes visible and recoverable in this same History response.
  await reconcileCurrentUserStaleAttempts(userId)

  const existencePromise = supabase
    .from('attempts')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['done', 'failed', 'timed_out'])
    .limit(1)

  let cohortQuery = supabase
    .from('attempts')
    .select('id, created_at, score, section_scores, practice_mode')
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

  const offset = (historyQuery.page - 1) * HISTORY_PAGE_SIZE
  let pageQuery = supabase
    .from('attempts')
    .select(
      `id, created_at, prompt_text, score, section_scores, practice_mode, prompt_source,
       retry_of_attempt_id, status, failure_code, lesson_id,
       lesson:practice_lessons!attempts_lesson_id_fkey(
         title, position, checkpoint,
         chapter:practice_chapters!practice_lessons_chapter_id_fkey(
           title, level,
           path:practice_paths!practice_chapters_path_id_fkey(slug, title)
         )
       )`,
    )
    .eq('user_id', userId)
    .in('status', ['done', 'failed', 'timed_out'])
  pageQuery = applyMetadataFilter(pageQuery, historyQuery.metadata)
  const pageResult = await pageQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + HISTORY_PAGE_SIZE)
  if (pageResult.error) return { status: 'failure', operation: 'page', error: pageResult.error }

  const rawRows: unknown = pageResult.data ?? []
  if (!Array.isArray(rawRows)) {
    return { status: 'failure', operation: 'page', error: { code: 'INVALID_RESPONSE' } }
  }
  const rows: HistoryEntry[] = []
  for (const value of rawRows.slice(0, HISTORY_PAGE_SIZE)) {
    const parsed = historyPageRow(value)
    const entry = parsed ? historyEntry(parsed) : null
    if (!entry) {
      return { status: 'failure', operation: 'page', error: { code: 'INVALID_RESPONSE' } }
    }
    rows.push(entry)
  }
  return {
    status: 'ready',
    data: {
      entries: rows,
      scoreSummary: summary,
      hasAnyEntries: (existenceResult.data?.length ?? 0) > 0,
      hasNext: rawRows.length > HISTORY_PAGE_SIZE,
      hasPrevious: historyQuery.page > 1,
    },
  }
}
