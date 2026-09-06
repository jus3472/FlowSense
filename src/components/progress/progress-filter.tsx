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
    <label className="text-foreground flex w-full flex-col gap-2 text-sm font-medium sm:w-56">
      Show responses
      <select
        value={filter}
        onChange={(event) => router.push(progressFilterHref(event.target.value as ProgressFilter))}
        className={FIELD_CONTROL_CLASS}
      >
        {PROGRESS_FILTERS.map((value) => (
          <option key={value} value={value}>
            {PROGRESS_FILTER_LABELS[value]}
          </option>
        ))}
      </select>
    </label>
  )
}
