import { ResponseFilter } from '@/components/ui/response-filter'
import {
  PROGRESS_FILTERS,
  PROGRESS_FILTER_LABELS,
  progressFilterHref,
} from '@/lib/progress/display'
import type { ProgressFilter } from '@/lib/progress/v3-aggregation'

export function ProgressFilterNav({ filter }: { filter: ProgressFilter }) {
  return (
    <ResponseFilter
      id="progress-response-filter-label"
      selected={filter}
      options={PROGRESS_FILTERS.map((value) => ({
        value,
        label: PROGRESS_FILTER_LABELS[value],
        href: progressFilterHref(value),
      }))}
    />
  )
}
