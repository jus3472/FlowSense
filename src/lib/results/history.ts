import { dayKey } from '@/lib/streak'

export interface HistoryEntry {
  id: string
  createdAt: string
  promptText: string
  score: number
  promptSource?: 'library' | 'custom' | null
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

export const FILTER_LABEL: Record<HistoryFilter, string> = {
  all: 'All',
  high: 'High scores',
  low: 'Low scores',
}

export function averageScore(entries: readonly HistoryEntry[]): number {
  if (entries.length === 0) return 0
  return entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length
}

/** Split against the speaker's own average rather than a fixed cutoff. */
export function applyFilter(
  entries: readonly HistoryEntry[],
  filter: HistoryFilter,
): HistoryEntry[] {
  if (filter === 'all') return [...entries]
  const average = averageScore(entries)
  return entries.filter((entry) =>
    filter === 'high' ? entry.score >= average : entry.score < average,
  )
}
