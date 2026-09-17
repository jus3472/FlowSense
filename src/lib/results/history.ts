import type { Route } from 'next'
import { ATTEMPT_FAILURE_CODES, type AttemptStatus } from '@/lib/attempts/lifecycle'
import type { ChapterLevel, PathSlug, Stars } from '@/lib/curriculum/contracts'
import type { PracticeMode, PromptSource } from '@/lib/practice/contracts'
import type { PracticeCategory } from '@/lib/practice/category'
import { TRACK_IDENTITIES } from '@/lib/curriculum/track-identity'
import type { HistoryResultKind } from '@/lib/results/history-result'
import { localDateKey, safeTimezone } from '@/lib/timezone'

export interface HistoryEntry {
  id: string
  createdAt: string
  promptText: string | null
  score: number | null
  resultKind?: HistoryResultKind
  practiceMode?: PracticeMode | null
  promptSource?: PromptSource | null
  category?: PracticeCategory | null
  retryOfAttemptId?: string | null
  status?: Extract<AttemptStatus, 'done' | 'failed' | 'timed_out'>
  failureCode?: string | null
  lesson?: HistoryLessonContext
}

export interface HistoryLessonContext {
  pathSlug: PathSlug
  pathTitle: string
  chapterLevel: ChapterLevel
  chapterTitle: string
  lessonTitle: string
  lessonPosition: number
  checkpoint: boolean
  stars: Stars
  outcome: 'passed' | 'not_passed' | 'neutral'
}

export interface HistoryGroup {
  key: string
  label: string
  entries: HistoryEntry[]
}

function previousDateKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! - 1)).toISOString().slice(0, 10)
}

export function dayLabel(iso: string, now: Date, timezone: string): string {
  const date = new Date(iso)
  const safe = safeTimezone(timezone)
  const today = localDateKey(now, safe)
  const yesterday = previousDateKey(today)
  const key = localDateKey(date, safe)

  if (key === today) return 'Today'
  if (key === yesterday) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safe,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

export function timeLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** Newest first, grouped into days. */
export function groupByDay(
  entries: readonly HistoryEntry[],
  now: Date,
  timezone: string,
): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>()
  const safe = safeTimezone(timezone)

  for (const entry of [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )) {
    const key = localDateKey(new Date(entry.createdAt), safe)
    const existing = groups.get(key)
    if (existing) existing.entries.push(entry)
    else groups.set(key, { key, label: dayLabel(entry.createdAt, now, safe), entries: [entry] })
  }

  return [...groups.values()]
}

export type HistoryMetadataFilter =
  'all' | 'general' | 'interview' | 'presentation' | 'conversation' | 'custom' | 'other' | 'retry'

export const METADATA_FILTER_LABEL: Record<HistoryMetadataFilter, string> = {
  all: 'All',
  general: TRACK_IDENTITIES['general-speaking'].title,
  interview: TRACK_IDENTITIES.interviews.title,
  presentation: TRACK_IDENTITIES.presentations.title,
  conversation: TRACK_IDENTITIES.conversations.title,
  custom: 'Custom Prompts',
  other: 'Other',
  retry: 'Retries',
}

export interface HistoryQuery {
  metadata: HistoryMetadataFilter
  page: number
}

export const DEFAULT_HISTORY_QUERY: HistoryQuery = {
  metadata: 'all',
  page: 1,
}

export type HistorySearchParams = Record<string, string | string[] | undefined>

const HISTORY_METADATA_FILTERS: readonly HistoryMetadataFilter[] = [
  'all',
  'general',
  'interview',
  'presentation',
  'conversation',
  'custom',
  'other',
  'retry',
]

function singular(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function parseHistoryQuery(
  params: HistorySearchParams,
): { status: 'valid'; query: HistoryQuery; canonical?: true } | { status: 'invalid' } {
  if (Array.isArray(params.show) || Array.isArray(params.score) || Array.isArray(params.page))
    return { status: 'invalid' }
  const metadata = singular(params.show) ?? DEFAULT_HISTORY_QUERY.metadata
  const obsoleteScore = singular(params.score)
  const rawPage = singular(params.page)
  if (
    !HISTORY_METADATA_FILTERS.includes(metadata as HistoryMetadataFilter) ||
    (obsoleteScore !== undefined && !['all', 'high', 'low'].includes(obsoleteScore)) ||
    (rawPage !== undefined && !/^[1-9]\d{0,4}$/.test(rawPage))
  )
    return { status: 'invalid' }
  return {
    status: 'valid',
    query: {
      metadata: metadata as HistoryMetadataFilter,
      page: rawPage ? Number(rawPage) : DEFAULT_HISTORY_QUERY.page,
    },
    ...(obsoleteScore !== undefined ? { canonical: true as const } : {}),
  }
}

export function historyHref(query: HistoryQuery): Route {
  const params = new URLSearchParams()
  if (query.metadata !== DEFAULT_HISTORY_QUERY.metadata) params.set('show', query.metadata)
  if (query.page !== DEFAULT_HISTORY_QUERY.page) params.set('page', String(query.page))
  const suffix = params.toString()
  return (suffix ? `/history?${suffix}` : '/history') as Route
}

const MODE_LABEL: Record<PracticeMode, string> = {
  practice: 'General Practice',
  interview: 'Interview',
  presentation: 'Presentation',
  conversation: 'Conversation',
}

export function historyMode(entry: HistoryEntry): HistoryMetadataFilter {
  if (entry.promptSource === 'custom' && entry.category === 'other') return 'other'
  if (entry.practiceMode === 'interview') return 'interview'
  if (entry.practiceMode === 'presentation') return 'presentation'
  if (entry.practiceMode === 'conversation') return 'conversation'
  return 'general'
}

/** Concise stored metadata only. Missing optional values deliberately stay neutral. */
export function historyContext(entry: HistoryEntry): string[] {
  if (entry.lesson) {
    return [
      ...(entry.lesson.checkpoint ? ['Checkpoint'] : []),
      ...(typeof entry.retryOfAttemptId === 'string' ? ['Retry'] : []),
    ]
  }
  const mode =
    entry.promptSource === 'custom' && entry.category === 'other'
      ? 'Other'
      : entry.practiceMode
        ? MODE_LABEL[entry.practiceMode]
        : 'General'
  return [
    mode,
    ...(entry.promptSource === 'custom' ? ['Custom prompt'] : []),
    ...(entry.promptSource === 'library' ? ['Library prompt'] : []),
    ...(typeof entry.retryOfAttemptId === 'string' ? ['Retry'] : []),
    ...(entry.resultKind === 'unsupported' ? ['Unsupported result'] : []),
    ...(entry.resultKind === 'partial' ? ['Partial result'] : []),
    ...(entry.failureCode === ATTEMPT_FAILURE_CODES.clientUploadAbandoned
      ? ['Unfinished recording']
      : entry.status === 'failed'
        ? ['Processing failed']
        : entry.status === 'timed_out'
          ? ['Processing timed out']
          : []),
  ]
}

export function historyLessonResultLabel(entry: HistoryEntry): string | null {
  if (!entry.lesson) return null
  if (entry.lesson.outcome === 'passed') return 'Passed'
  if (entry.lesson.outcome === 'not_passed') return 'Not passed'
  return 'Result unavailable'
}

export function historyStarsLabel(entry: HistoryEntry): string | null {
  if (!entry.lesson || entry.lesson.stars === 0) return null
  return `${'★'.repeat(entry.lesson.stars)}${'☆'.repeat(3 - entry.lesson.stars)}`
}

export function historyScoreLabel(entry: HistoryEntry): string {
  if (entry.status === 'failed' || entry.status === 'timed_out') return 'Not scored'
  if (entry.resultKind === 'unsupported') return 'Unsupported'
  if (entry.score === null) return 'Overall unavailable'
  return String(entry.score)
}
