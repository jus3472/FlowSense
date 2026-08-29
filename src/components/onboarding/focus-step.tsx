'use client'

import { saveFocusAreas } from '@/actions/onboarding'
import { PathPreferenceFields } from '@/components/onboarding/path-preference-fields'
import { StepFrame } from '@/components/onboarding/step-frame'
import { SubmitButton } from '@/components/ui/submit-button'
import type { PathSlug } from '@/lib/curriculum/contracts'
import type { PathPreferenceOption } from '@/lib/path-preferences'

interface FocusStepProps {
  paths: readonly PathPreferenceOption[]
  initialPrimary: PathSlug
  initialSecondaries: readonly PathSlug[]
  error: 'primary' | 'save' | null
}

export function FocusStep({ paths, initialPrimary, initialSecondaries, error }: FocusStepProps) {
  return (
    <StepFrame step={2} title="What do you want to get better at?">
      <div className="flex flex-col gap-6">
        <p className="text-muted text-base">
          Choose one primary path and any additional paths you want to follow.
        </p>

        {error ? (
          <p role="alert" className="text-negative text-sm">
            {error === 'primary'
              ? 'Choose one primary path.'
              : 'Your choices did not save. Check your connection and try again.'}
          </p>
        ) : null}

        <form action={saveFocusAreas} className="flex flex-col gap-8">
          <PathPreferenceFields
            paths={paths}
            initialPrimary={initialPrimary}
            initialSecondaries={initialSecondaries}
          />
          <div>
            <SubmitButton size="lg" fullWidth loadingLabel="Saving">
              Continue
            </SubmitButton>
          </div>
        </form>
      </div>
    </StepFrame>
  )
}
