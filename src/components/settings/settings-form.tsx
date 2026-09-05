'use client'

import { useActionState, useEffect, useRef } from 'react'
import { updateProfile } from '@/actions/profile'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { initialProfileFormState } from '@/lib/forms'
import { browserTimezone, UTC_TIMEZONE } from '@/lib/timezone'

interface SettingsFormProps {
  displayName: string
}

export function SettingsForm({ displayName }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(updateProfile, initialProfileFormState)
  const timezoneInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (timezoneInput.current) timezoneInput.current.value = browserTimezone()
  }, [])

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <TextField
        id="display_name"
        name="display_name"
        label="Display name"
        defaultValue={displayName}
        autoComplete="name"
        placeholder="Optional"
        error={state.displayNameError}
      />

      <input ref={timezoneInput} type="hidden" name="timezone" defaultValue={UTC_TIMEZONE} />

      {state.message ? (
        <p
          role="status"
          className={
            state.status === 'error'
              ? 'bg-negative-soft text-negative rounded-input px-4 py-3 text-sm'
              : 'bg-surface-sunken text-muted rounded-input px-4 py-3 text-sm'
          }
        >
          {state.message}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="lg" loading={pending} loadingLabel="Saving">
          Save changes
        </Button>
      </div>
    </form>
  )
}
