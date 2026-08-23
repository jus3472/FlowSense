'use server'

import { redirect } from 'next/navigation'
import { sanitizeFocusAreas } from '@/lib/focus-areas'
import { ONBOARDED_AT_KEY } from '@/lib/onboarding'
import { createClient } from '@/lib/supabase/server'

async function markOnboarded() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.auth.updateUser({
    data: { [ONBOARDED_AT_KEY]: new Date().toISOString() },
  })
  return { supabase, user, error }
}

export async function saveFocusAreas(formData: FormData) {
  const focusAreas = sanitizeFocusAreas(formData.getAll('focus').map(String))

  const { supabase, user, error: metadataError } = await markOnboarded()

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ focus_areas: focusAreas })
    .eq('id', user.id)

  if (profileError || metadataError) redirect('/onboarding/focus?error=save')
  redirect('/home')
}

export async function skipFocusAreas() {
  const { error } = await markOnboarded()
  if (error) redirect('/onboarding/focus?error=save')
  redirect('/home')
}
