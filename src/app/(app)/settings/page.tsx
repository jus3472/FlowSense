import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LogoutForm } from '@/components/settings/logout-form'
import { SettingsForm } from '@/components/settings/settings-form'
import { sanitizeFocusAreas } from '@/lib/focus-areas'
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, focus_areas')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <div className="flex flex-col gap-12 pt-4 pb-12">
      <h1 className="prompt-display text-foreground text-2xl">Settings</h1>

      <SettingsForm
        displayName={profile?.display_name ?? ''}
        focusAreas={sanitizeFocusAreas(profile?.focus_areas ?? [])}
      />

      <LogoutForm failed={query.logout === 'failed'} />
    </div>
  )
}
