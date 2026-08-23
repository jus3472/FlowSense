'use client'

import { useActionState, useState } from 'react'
import { updateProfile } from '@/actions/profile'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { TextField } from '@/components/ui/text-field'
import { FOCUS_AREAS } from '@/lib/focus-areas'
import { initialProfileFormState } from '@/lib/forms'

interface SettingsFormProps {
  displayName: string
  focusAreas: string[]
}

export function SettingsForm({ displayName, focusAreas }: SettingsFormProps) {
  const [selected, setSelected] = useState<string[]>(focusAreas)
  const [state, formAction, pending] = useActionState(updateProfile, initialProfileFormState)

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
  }

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

      <fieldset className="flex flex-col gap-4">
        <legend className="text-foreground text-sm font-medium">Focus areas</legend>
        <div className="flex flex-wrap gap-2">
          {FOCUS_AREAS.map((area) => (
            <Chip
              key={area.id}
              label={area.label}
              selected={selected.includes(area.id)}
              onToggle={() => toggle(area.id)}
            />
          ))}
        </div>
        {selected.map((id) => (
          <input key={id} type="hidden" name="focus" value={id} />
        ))}
      </fieldset>

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
