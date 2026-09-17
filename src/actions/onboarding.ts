'use server'

import { redirect } from 'next/navigation'
import { ONBOARDED_AT_KEY } from '@/lib/onboarding'
import { createClient } from '@/lib/supabase/server'
import { isValidIanaTimezone, safeTimezone } from '@/lib/timezone'

async function authenticatedClient() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return { supabase, user }
}

async function markOnboarded(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase.auth.updateUser({
    data: { [ONBOARDED_AT_KEY]: new Date().toISOString() },
  })
}

export async function completeOnboarding(formData: FormData) {
  const { supabase, user } = await authenticatedClient()
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('profiles')
    .select('id, timezone')
    .eq('id', user.id)
    .maybeSingle()
  if (existingProfileError) redirect('/onboarding/focus?error=save')

  const submittedTimezone = safeTimezone(formData.get('timezone'))
  const timezone = isValidIanaTimezone(existingProfile?.timezone)
    ? existingProfile.timezone
    : submittedTimezone
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: user.id, timezone }, { onConflict: 'id' })
    .select('id, timezone')
    .maybeSingle()

  if (profileError || profile?.id !== user.id || profile.timezone !== timezone) {
    redirect('/onboarding/focus?error=save')
  }

  const { error: metadataError } = await markOnboarded(supabase)
  if (metadataError) redirect('/onboarding/focus?error=save')
  redirect('/home')
}
