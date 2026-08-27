import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FocusStep } from '@/components/onboarding/focus-step'
import { StepFrame } from '@/components/onboarding/step-frame'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { loadProfilePreferences, logProfilePreferencesLoadFailure } from '@/lib/profile-preferences'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Practice goals',
}

export default async function FocusPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await loadProfilePreferences(
    supabase.from('profiles').select('focus_areas').eq('id', user.id).maybeSingle(),
  )

  if (profile.status === 'failure') {
    logProfilePreferencesLoadFailure('onboarding_practice_goals', profile)
    return (
      <StepFrame step={2} title="What do you want to practice?">
        <ErrorState
          title="Your practice goals did not load"
          description="The connection to your account failed. Your saved choices are unchanged."
        >
          <RetryButton />
        </ErrorState>
      </StepFrame>
    )
  }

  return <FocusStep initialSelected={profile.data.focusAreas} saveFailed={error === 'save'} />
}
