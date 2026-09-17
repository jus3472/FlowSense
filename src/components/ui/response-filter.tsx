'use client'

import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { SelectControl } from '@/components/ui/select-control'

export interface ResponseFilterOption {
  value: string
  label: string
  href: Route
}

/** Shared compact URL-backed filter for History and Progress. */
export function ResponseFilter({
  id,
  selected,
  options,
}: {
  id: string
  selected: string
  options: readonly ResponseFilterOption[]
}) {
  const router = useRouter()

  return (
    <nav aria-label="Response filter" className="w-full sm:w-64">
      <label htmlFor={id} className="sr-only">
        Show responses
      </label>
      <SelectControl
        id={id}
        value={selected}
        aria-label="Show responses"
        onChange={(event) => {
          const option = options.find(({ value }) => value === event.target.value)
          if (option) router.push(option.href)
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectControl>
    </nav>
  )
}
