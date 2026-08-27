import type { Route } from 'next'
import { dayKey } from '@/lib/streak'
import type { PracticeMode, PromptSource } from '@/lib/practice/contracts'
import type { HistoryResultKind } from '@/lib/results/history-cohort'

export interface HistoryEntry {
  id: string
  createdAt: string
  promptText: string
  score: number | null
  resultKind?: HistoryResultKind
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

export type HistoryMetadataFilter =
  'all' | 'general' | 'interview' | 'presentation' | 'conversation' | 'custom' | 'retry'

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
    ...(entry.resultKind === 'unsupported' ? ['Unsupported result'] : []),
    ...(entry.resultKind === 'partial' ? ['Partial result'] : []),
  ]
}

export function historyScoreLabel(entry: HistoryEntry): string {
  if (entry.resultKind === 'unsupported') return 'Unsupported'
  if (entry.score === null) return 'Overall unavailable'
  return String(entry.score)
}

export function matchesMetadataFilter(entry: HistoryEntry, filter: HistoryMetadataFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'custom') return entry.promptSource === 'custom'
  if (filter === 'retry') return typeof entry.retryOfAttemptId === 'string'
  return historyMode(entry) === filter
}
