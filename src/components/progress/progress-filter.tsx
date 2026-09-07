'use client'

import { useRouter } from 'next/navigation'
import { FIELD_CONTROL_CLASS } from '@/components/ui/text-field'
import {
  PROGRESS_FILTERS,
  PROGRESS_FILTER_LABELS,
  progressFilterHref,
} from '@/lib/progress/display'
import type { ProgressFilter } from '@/lib/progress/v3-aggregation'

export function ProgressFilterSelect({ filter }: { filter: ProgressFilter }) {
  const router = useRouter()

  return (
    <div className="flex w-full flex-col gap-2 sm:w-56">
      <label htmlFor="progress-response-filter" className="text-foreground text-sm font-medium">
        Show responses
      </label>
      <div className="relative">
        <select
          id="progress-response-filter"
          value={filter}
          onChange={(event) =>
            router.push(progressFilterHref(event.target.value as ProgressFilter))
          }
          className={`${FIELD_CONTROL_CLASS} w-full cursor-pointer appearance-none pr-12`}
        >
          {PROGRESS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {PROGRESS_FILTER_LABELS[value]}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="text-muted pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2"
          fill="currentColor"
        >
          <path d="M5.3 7.3 10 12l4.7-4.7-1.4-1.4L10 9.2 6.7 5.9z" />
        </svg>
      </div>
    </div>
  )
}
