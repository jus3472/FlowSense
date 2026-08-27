import type { Route } from 'next'
import { dayKey } from '@/lib/streak'
import type { PracticeMode, PromptSource } from '@/lib/practice/contracts'

export interface HistoryEntry {
  id: string
  createdAt: string
  promptText: string
  score: number | null
  practiceMode?: PracticeMode | null
  promptSource?: PromptSource | null
  retryOfAttemptId?: string | null
}

export interface HistoryGroup {
  key: string
  label: string
  entries: HistoryEntry[]
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})

export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const key = dayKey(date)

  if (key === today) return 'Today'
  if (key === yesterday) return 'Yesterday'
  return DATE_FORMAT.format(date)
}

export function timeLabel(iso: string): string {
  return TIME_FORMAT.format(new Date(iso))
}

/** Newest first, grouped into days. */
export function groupByDay(
  entries: readonly HistoryEntry[],
  now: Date = new Date(),
): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>()

  for (const entry of [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )) {
    const key = dayKey(new Date(entry.createdAt))
    const existing = groups.get(key)
    if (existing) existing.entries.push(entry)
    else groups.set(key, { key, label: dayLabel(entry.createdAt, now), entries: [entry] })
  }

  return [...groups.values()]
}

export type HistoryFilter = 'all' | 'high' | 'low'

export type HistoryMetadataFilter =
  'all' | 'general' | 'interview' | 'presentation' | 'conversation' | 'custom' | 'retry'

export const FILTER_LABEL: Record<HistoryFilter, string> = {
  all: 'All',
  high: 'High scores',
  low: 'Low scores',
}

export const METADATA_FILTER_LABEL: Record<HistoryMetadataFilter, string> = {
  all: 'All responses',
  general: 'General Practice',
  interview: 'Interviews',
  presentation: 'Presentations',
  conversation: 'Conversations',
  custom: 'Custom prompts',
  retry: 'Retries',
}

export interface HistoryQuery {
  metadata: HistoryMetadataFilter
  score: HistoryFilter
  page: number
}

export const DEFAULT_HISTORY_QUERY: HistoryQuery = {
  metadata: 'all',
  score: 'all',
  page: 1,
}

export type HistorySearchParams = Record<string, string | string[] | undefined>

const HISTORY_FILTERS: readonly HistoryFilter[] = ['all', 'high', 'low']
const HISTORY_METADATA_FILTERS: readonly HistoryMetadataFilter[] = [
  'all',
  'general',
  'interview',
  'presentation',
  'conversation',
  'custom',
  'retry',
]

function singular(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function parseHistoryQuery(
  params: HistorySearchParams,
): { status: 'valid'; query: HistoryQuery } | { status: 'invalid' } {
  if (Array.isArray(params.show) || Array.isArray(params.score) || Array.isArray(params.page))
    return { status: 'invalid' }
  const metadata = singular(params.show) ?? DEFAULT_HISTORY_QUERY.metadata
  const score = singular(params.score) ?? DEFAULT_HISTORY_QUERY.score
  const rawPage = singular(params.page)
  if (
    !HISTORY_METADATA_FILTERS.includes(metadata as HistoryMetadataFilter) ||
    !HISTORY_FILTERS.includes(score as HistoryFilter) ||
    (rawPage !== undefined && !/^[1-9]\d{0,4}$/.test(rawPage))
  )
    return { status: 'invalid' }
  return {
    status: 'valid',
    query: {
      metadata: metadata as HistoryMetadataFilter,
      score: score as HistoryFilter,
      page: rawPage ? Number(rawPage) : DEFAULT_HISTORY_QUERY.page,
    },
  }
}

export function historyHref(query: HistoryQuery): Route {
  const params = new URLSearchParams()
  if (query.metadata !== DEFAULT_HISTORY_QUERY.metadata) params.set('show', query.metadata)
  if (query.score !== DEFAULT_HISTORY_QUERY.score) params.set('score', query.score)
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
  if (entry.practiceMode === 'interview') return 'interview'
  if (entry.practiceMode === 'presentation') return 'presentation'
  if (entry.practiceMode === 'conversation') return 'conversation'
  return 'general'
}

/** Concise stored metadata only. Null legacy values deliberately stay neutral. */
export function historyContext(entry: HistoryEntry): string[] {
  const mode = entry.practiceMode ? MODE_LABEL[entry.practiceMode] : 'General'
  return [
    mode,
    ...(entry.promptSource === 'custom' ? ['Custom prompt'] : []),
    ...(entry.promptSource === 'library' ? ['Library prompt'] : []),
    ...(typeof entry.retryOfAttemptId === 'string' ? ['Retry'] : []),
  ]
}

export function matchesMetadataFilter(entry: HistoryEntry, filter: HistoryMetadataFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'custom') return entry.promptSource === 'custom'
  if (filter === 'retry') return typeof entry.retryOfAttemptId === 'string'
  return historyMode(entry) === filter
}

export function averageScore(entries: readonly HistoryEntry[]): number {
  const scores = entries
    .map((entry) => entry.score)
    .filter((score): score is number => score !== null)
  if (scores.length === 0) return 0
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

/** Split against the speaker's own average rather than a fixed cutoff. */
export function applyFilter(
  entries: readonly HistoryEntry[],
  filter: HistoryFilter,
): HistoryEntry[] {
  if (filter === 'all') return [...entries]
  const average = averageScore(entries)
  return entries.filter((entry) =>
    entry.score === null
      ? false
      : filter === 'high'
        ? entry.score >= average
        : entry.score < average,
  )
}

/** Applies metadata first, then the existing score split against the filtered set. */
export function applyHistoryFilters(
  entries: readonly HistoryEntry[],
  metadataFilter: HistoryMetadataFilter,
  scoreFilter: HistoryFilter,
): HistoryEntry[] {
  return applyFilter(
    entries.filter((entry) => matchesMetadataFilter(entry, metadataFilter)),
    scoreFilter,
  )
}
