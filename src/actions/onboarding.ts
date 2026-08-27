'use server'

import { redirect } from 'next/navigation'
import { sanitizeFocusAreas } from '@/lib/focus-areas'
import { ONBOARDED_AT_KEY } from '@/lib/onboarding'
import { createClient } from '@/lib/supabase/server'

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
  const focusAreas = sanitizeFocusAreas(formData.getAll('focus').map(String))
  const { supabase, user } = await authenticatedClient()
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: user.id, focus_areas: focusAreas }, { onConflict: 'id' })
    .select('id, focus_areas')
    .maybeSingle()

  if (
    profileError ||
    profile?.id !== user.id ||
    JSON.stringify(sanitizeFocusAreas(profile.focus_areas)) !== JSON.stringify(focusAreas)
  )
    redirect('/onboarding/focus?error=save')
  const { error: metadataError } = await markOnboarded(supabase)
  if (metadataError) redirect('/onboarding/focus?error=save')
  redirect('/home')
}

export async function skipFocusAreas() {
  const { supabase, user } = await authenticatedClient()
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: user.id }, { onConflict: 'id' })
    .select('id')
    .maybeSingle()
  if (profileError || profile?.id !== user.id) redirect('/onboarding/focus?error=save')
  const { error: metadataError } = await markOnboarded(supabase)
  if (metadataError) redirect('/onboarding/focus?error=save')
  redirect('/home')
}
