'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { PathSlug } from '@/lib/curriculum/contracts'
import type { PathPreferenceOption } from '@/lib/path-preferences'
import { browserTimezone, UTC_TIMEZONE } from '@/lib/timezone'

interface PathPreferenceFieldsProps {
  paths: readonly PathPreferenceOption[]
  initialPrimary: PathSlug
  initialSecondaries: readonly PathSlug[]
}

export function PathPreferenceFields({
  paths,
  initialPrimary,
  initialSecondaries,
}: PathPreferenceFieldsProps) {
  const [primary, setPrimary] = useState<PathSlug>(initialPrimary)
  const [secondaries, setSecondaries] = useState<readonly PathSlug[]>(initialSecondaries)
  const timezoneInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (timezoneInput.current) timezoneInput.current.value = browserTimezone()
  }, [])

  const choosePrimary = (slug: PathSlug) => {
    setPrimary(slug)
    setSecondaries((current) => current.filter((selected) => selected !== slug))
  }

  const toggleSecondary = (slug: PathSlug) => {
    if (slug === primary) return
    setSecondaries((current) =>
      current.includes(slug)
        ? current.filter((selected) => selected !== slug)
        : [...current, slug],
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-4">
        <legend className="text-foreground text-sm font-medium">Primary path</legend>
        <p className="text-muted text-sm">This path appears first on Home.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {paths.map((path) => {
            const selected = primary === path.slug
            return (
              <label
                key={path.id}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center rounded-card bg-surface-sunken px-4 py-3 text-sm font-medium transition duration-150 ease-out',
                  selected && 'bg-accent-soft ring-accent ring-2 ring-inset',
                )}
              >
                <input
                  type="radio"
                  name="primary_path"
                  value={path.slug}
                  checked={selected}
                  onChange={() => choosePrimary(path.slug)}
                  className="sr-only"
                  required
                />
                <span className="text-foreground">{path.title}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-foreground text-sm font-medium">Additional paths</legend>
        <p className="text-muted text-sm">Choose any others you want to follow.</p>
        <div className="flex flex-col gap-3">
          {paths.map((path) => {
            const isPrimary = path.slug === primary
            const selected = secondaries.includes(path.slug)
            return (
              <label
                key={path.id}
                className={cn(
                  'flex min-h-11 items-center justify-between rounded-input bg-surface-sunken px-4 py-3 text-sm',
                  isPrimary ? 'cursor-default opacity-60' : 'cursor-pointer',
                  selected && 'bg-accent-soft ring-accent ring-2 ring-inset',
                )}
              >
                <span className="text-foreground font-medium">{path.title}</span>
                <span aria-hidden="true" className="text-muted text-xs">
                  {isPrimary ? 'Primary' : selected ? 'Added' : ''}
                </span>
                <input
                  type="checkbox"
                  aria-label={path.title}
                  name="secondary_path"
                  value={path.slug}
                  checked={selected}
                  disabled={isPrimary}
                  onChange={() => toggleSecondary(path.slug)}
                  className="sr-only"
                />
              </label>
            )
          })}
        </div>
      </fieldset>

      <input ref={timezoneInput} type="hidden" name="timezone" defaultValue={UTC_TIMEZONE} />
    </div>
  )
}
