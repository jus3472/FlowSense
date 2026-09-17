'use client'

import { useEffect, useRef } from 'react'
import { completeOnboarding } from '@/actions/onboarding'
import { StepFrame } from '@/components/onboarding/step-frame'
import { TrackIcon } from '@/components/curriculum/track-identity'
import { SubmitButton } from '@/components/ui/submit-button'
import { TRACK_IDENTITY_LIST } from '@/lib/curriculum/track-identity'
import { browserTimezone, UTC_TIMEZONE } from '@/lib/timezone'

export function FocusStep({ error }: { error: boolean }) {
  const timezoneInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (timezoneInput.current) timezoneInput.current.value = browserTimezone()
  }, [])

  return (
    <StepFrame step={2} title="Practice across four tracks">
      <div className="flex flex-col gap-6">
        <p className="text-muted text-base">
          Home gives you four tracks. Start with the one that fits what you want to practice today.
        </p>

        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Available tracks">
          {TRACK_IDENTITY_LIST.map((track) => (
            <li
              key={track.slug}
              className="border-border bg-surface-sunken text-foreground rounded-input flex min-h-14 items-center gap-3 border px-4 py-3 text-sm font-medium"
            >
              <TrackIcon slug={track.slug} className="text-accent-ink size-5 shrink-0" />
              {track.title}
            </li>
          ))}
        </ul>

        {error ? (
          <p role="alert" className="text-negative text-sm">
            Your setup did not save. Check your connection and try again.
          </p>
        ) : null}

        <form action={completeOnboarding} className="flex flex-col gap-8">
          <input ref={timezoneInput} type="hidden" name="timezone" defaultValue={UTC_TIMEZONE} />
          <SubmitButton size="lg" fullWidth loadingLabel="Opening Home">
            Go to Home
          </SubmitButton>
        </form>
      </div>
    </StepFrame>
  )
}
