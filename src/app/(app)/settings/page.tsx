import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LogoutForm } from '@/components/settings/logout-form'
import { SettingsForm } from '@/components/settings/settings-form'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'
import { loadProfilePreferences, logProfilePreferencesLoadFailure } from '@/lib/profile-preferences'
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

  const profile = await loadProfilePreferences(
    supabase.from('profiles').select('display_name, timezone').eq('id', user.id).maybeSingle(),
  )

  if (profile.status === 'failure') {
    logProfilePreferencesLoadFailure('settings', profile)
    return (
      <PageShell width="column">
        <PageTitle>Settings</PageTitle>
        <ErrorState
          title="Your settings did not load"
          description="The connection to your account failed. Your saved settings are unchanged."
        >
          <RetryButton />
        </ErrorState>
        <LogoutForm failed={query.logout === 'failed'} />
      </PageShell>
    )
  }

  return (
    <PageShell width="column">
      <PageTitle>Settings</PageTitle>

      <Card className="flex flex-col gap-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <h2 className="prompt-display text-foreground text-xl">Profile</h2>
          <p className="text-muted text-sm">Update how your name appears in FlowSense.</p>
        </div>
        <SettingsForm displayName={profile.data.displayName} />
      </Card>

      <section
        aria-labelledby="account-heading"
        className="border-border flex flex-col gap-4 border-t pt-8"
      >
        <h2 id="account-heading" className="text-foreground text-lg font-medium">
          Account
        </h2>
        <LogoutForm failed={query.logout === 'failed'} />
      </section>
    </PageShell>
  )
}
