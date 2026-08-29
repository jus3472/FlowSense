import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LogoutForm } from '@/components/settings/logout-form'
import { SettingsForm } from '@/components/settings/settings-form'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { loadProfilePreferences, logProfilePreferencesLoadFailure } from '@/lib/profile-preferences'
import {
  loadPathPreferencesForUser,
  logPathPreferencesFailure,
} from '@/lib/path-preferences-server'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Settings',
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ logout?: string | string[] }>
}) {
  const query = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profile, paths] = await Promise.all([
    loadProfilePreferences(
      supabase
        .from('profiles')
        .select('display_name, focus_areas, timezone')
        .eq('id', user.id)
        .maybeSingle(),
    ),
    loadPathPreferencesForUser(supabase, user.id),
  ])

  if (profile.status === 'failure' || paths.status === 'failure') {
    if (profile.status === 'failure') logProfilePreferencesLoadFailure('settings', profile)
    if (paths.status === 'failure') logPathPreferencesFailure('settings', paths)
    return (
      <div className="flex flex-col gap-12 pt-4 pb-12">
        <h1 className="prompt-display text-foreground text-2xl">Settings</h1>
        <ErrorState
          title="Your settings did not load"
          description="The connection to your account failed. Your saved settings are unchanged."
        >
          <RetryButton />
        </ErrorState>
        <LogoutForm failed={query.logout === 'failed'} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-12 pt-4 pb-12">
      <h1 className="prompt-display text-foreground text-2xl">Settings</h1>

      <SettingsForm
        displayName={profile.data.displayName}
        paths={paths.data.paths}
        primarySlug={paths.data.primarySlug}
        secondarySlugs={paths.data.secondarySlugs}
      />

      <LogoutForm failed={query.logout === 'failed'} />
    </div>
  )
}
