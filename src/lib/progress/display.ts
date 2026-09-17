import type { Route } from 'next'
import { PRACTICE_MODES } from '@/lib/practice/contracts'
import { METADATA_FILTER_LABEL } from '@/lib/results/history'
import type { ProgressFilter } from '@/lib/progress/v3-aggregation'

export const PROGRESS_FILTERS = ['all', ...PRACTICE_MODES, 'custom', 'other'] as const

export const PROGRESS_FILTER_LABELS: Readonly<Record<ProgressFilter, string>> = Object.freeze({
  all: 'All',
  practice: METADATA_FILTER_LABEL.general,
  interview: METADATA_FILTER_LABEL.interview,
  presentation: METADATA_FILTER_LABEL.presentation,
  conversation: METADATA_FILTER_LABEL.conversation,
  custom: METADATA_FILTER_LABEL.custom,
  other: METADATA_FILTER_LABEL.other,
})

export type ProgressFilterParseResult =
  { status: 'valid'; filter: ProgressFilter } | { status: 'invalid' }

export function parseProgressFilter(value: unknown): ProgressFilterParseResult {
  if (value === undefined) return { status: 'valid', filter: 'all' }
  if (
    typeof value !== 'string' ||
    value === 'all' ||
    !(PROGRESS_FILTERS as readonly string[]).includes(value)
  ) {
    return { status: 'invalid' }
  }
  return { status: 'valid', filter: value as ProgressFilter }
}

export function progressFilterHref(filter: ProgressFilter): Route {
  return (filter === 'all' ? '/progress' : `/progress?mode=${filter}`) as Route
}
