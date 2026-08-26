'use client'

import { useState } from 'react'
import { saveFocusAreas, skipFocusAreas } from '@/actions/onboarding'
import { StepFrame } from '@/components/onboarding/step-frame'
import { Chip } from '@/components/ui/chip'
import { SubmitButton } from '@/components/ui/submit-button'
import { FOCUS_AREAS } from '@/lib/focus-areas'

interface FocusStepProps {
  initialSelected: string[]
  saveFailed: boolean
}

export function FocusStep({ initialSelected, saveFailed }: FocusStepProps) {
  const [selected, setSelected] = useState<string[]>(initialSelected)

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
  }

  return (
    <StepFrame step={2} title="What do you want to practice?">
      <div className="flex flex-col gap-6">
        <p className="text-muted text-base">
          Pick as many as you want. This shapes your practice suggestions.
        </p>

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

        {saveFailed ? (
          <p role="alert" className="text-negative text-sm">
            Your choices did not save. Check your connection and try again.
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <form action={saveFocusAreas}>
            {selected.map((id) => (
              <input key={id} type="hidden" name="focus" value={id} />
            ))}
            <SubmitButton size="lg" fullWidth loadingLabel="Saving">
              Continue
            </SubmitButton>
          </form>

          <form action={skipFocusAreas}>
            <SubmitButton variant="ghost" fullWidth loadingLabel="Skipping">
              Skip for now
            </SubmitButton>
          </form>
        </div>
      </div>
    </StepFrame>
  )
}
