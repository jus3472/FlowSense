'use client'

import { useActionState } from 'react'
import { updateProfile } from '@/actions/profile'
import { PathPreferenceFields } from '@/components/onboarding/path-preference-fields'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import type { PathSlug } from '@/lib/curriculum/contracts'
import { initialProfileFormState } from '@/lib/forms'
import type { PathPreferenceOption } from '@/lib/path-preferences'

interface SettingsFormProps {
  displayName: string
  paths: readonly PathPreferenceOption[]
  primarySlug: PathSlug
  secondarySlugs: readonly PathSlug[]
}

export function SettingsForm({
  displayName,
  paths,
  primarySlug,
  secondarySlugs,
}: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(updateProfile, initialProfileFormState)

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <TextField
        id="display_name"
        name="display_name"
        label="Display name"
        defaultValue={displayName}
        autoComplete="name"
        placeholder="Optional"
        error={state.displayNameError}
      />

      <PathPreferenceFields
        paths={paths}
        initialPrimary={primarySlug}
        initialSecondaries={secondarySlugs}
      />

      {state.message ? (
        <p
          role="status"
          className={state.status === 'error' ? 'text-negative text-sm' : 'text-muted text-sm'}
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
