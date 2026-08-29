'use server'

import { redirect } from 'next/navigation'
import { ONBOARDED_AT_KEY } from '@/lib/onboarding'
import {
  legacyFocusAreasForPaths,
  parseSubmittedPathPreferences,
} from '@/lib/path-preferences'
import { replacePathPreferencesForUser } from '@/lib/path-preferences-server'
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

export async function saveFocusAreas(formData: FormData) {
  const orderedPaths = parseSubmittedPathPreferences(
    formData.get('primary_path'),
    formData.getAll('secondary_path'),
  )
  if (!orderedPaths) redirect('/onboarding/focus?error=primary')

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
  const focusAreas = legacyFocusAreasForPaths(orderedPaths)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: user.id, focus_areas: [...focusAreas], timezone }, { onConflict: 'id' })
    .select('id, focus_areas, timezone')
    .maybeSingle()

  if (
    profileError ||
    profile?.id !== user.id ||
    JSON.stringify(profile.focus_areas) !== JSON.stringify(focusAreas) ||
    profile.timezone !== timezone
  )
    redirect('/onboarding/focus?error=save')

  const preferenceSave = await replacePathPreferencesForUser(supabase, user.id, orderedPaths)
  if (preferenceSave.status === 'failure') redirect('/onboarding/focus?error=save')

  const { error: metadataError } = await markOnboarded(supabase)
  if (metadataError) redirect('/onboarding/focus?error=save')
  redirect('/home')
}
