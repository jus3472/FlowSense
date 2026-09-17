import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LogoutForm } from '@/components/settings/logout-form'
import { SettingsForm } from '@/components/settings/settings-form'
import { DataAndAccountActions } from '@/components/settings/data-account-actions'
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

function AccountIdentity({ email }: { email: string | undefined }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-foreground text-sm font-medium">Email</p>
      <p className="text-muted text-sm break-all">
        {email ?? 'No email is available for this account.'}
      </p>
    </div>
  )
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
        <AccountIdentity email={user.email} />
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

      <Card
        role="region"
        aria-labelledby="profile-account-heading"
        className="flex flex-col gap-6 sm:p-8"
      >
        <div className="flex flex-col gap-1">
          <h2 id="profile-account-heading" className="prompt-display text-foreground text-xl">
            Profile &amp; account
          </h2>
          <p className="text-muted text-sm">Manage your profile and sign-in.</p>
        </div>
        <AccountIdentity email={user.email} />
        <SettingsForm displayName={profile.data.displayName} />
        <div className="border-border border-t pt-6">
          <LogoutForm failed={query.logout === 'failed'} />
        </div>
      </Card>

      <Card
        role="region"
        aria-labelledby="data-account-heading"
        className="flex flex-col gap-6 sm:p-8"
      >
        <div className="flex flex-col gap-1">
          <h2 id="data-account-heading" className="prompt-display text-foreground text-xl">
            Data &amp; privacy
          </h2>
          <p className="text-muted text-sm">Manage your practice history or your account.</p>
        </div>
        <DataAndAccountActions />
      </Card>
    </PageShell>
  )
}
