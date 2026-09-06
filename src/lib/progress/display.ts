import type { Route } from 'next'
import { PRACTICE_MODES, type PracticeMode } from '@/lib/practice/contracts'
import type { ProgressFilter } from '@/lib/progress/v3-aggregation'

export const PROGRESS_FILTERS = ['all', ...PRACTICE_MODES] as const

export const PROGRESS_FILTER_LABELS: Readonly<Record<ProgressFilter, string>> = Object.freeze({
  all: 'All',
  practice: 'General Speaking',
  interview: 'Interviews',
  presentation: 'Presentations',
  conversation: 'Conversations',
})

export type ProgressFilterParseResult =
  { status: 'valid'; filter: ProgressFilter } | { status: 'invalid' }

export function parseProgressFilter(value: unknown): ProgressFilterParseResult {
  if (value === undefined) return { status: 'valid', filter: 'all' }
  if (typeof value !== 'string' || !(PRACTICE_MODES as readonly string[]).includes(value)) {
    return { status: 'invalid' }
  }
  return { status: 'valid', filter: value as PracticeMode }
}

export function progressFilterHref(filter: ProgressFilter): Route {
  return (filter === 'all' ? '/progress' : `/progress?mode=${filter}`) as Route
}
