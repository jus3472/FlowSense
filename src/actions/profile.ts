'use server'

import { revalidatePath } from 'next/cache'
import { sanitizeFocusAreas } from '@/lib/focus-areas'
import type { ProfileFormState } from '@/lib/forms'
import { createClient } from '@/lib/supabase/server'
import { validateDisplayName } from '@/lib/validation'

export async function updateProfile(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const displayName = String(formData.get('display_name') ?? '').trim()
  const displayNameError = validateDisplayName(displayName)
  if (displayNameError) {
    return { status: 'error', message: null, displayNameError }
  }

  const focusAreas = sanitizeFocusAreas(formData.getAll('focus').map(String))

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      status: 'error',
      message: 'Your session ended. Log in and try again.',
      displayNameError: null,
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: displayName.length > 0 ? displayName : null,
      focus_areas: focusAreas,
    })
    .eq('id', user.id)

  if (error) {
    return {
      status: 'error',
      message: 'Your changes did not save. Check your connection and try again.',
      displayNameError: null,
    }
  }

  revalidatePath('/home')
  revalidatePath('/settings')
  return { status: 'saved', message: 'Saved.', displayNameError: null }
}
