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

  const expectedDisplayName = displayName.length > 0 ? displayName : null
  const { data: profile, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        display_name: expectedDisplayName,
        focus_areas: focusAreas,
      },
      { onConflict: 'id' },
    )
    .select('id, display_name, focus_areas')
    .maybeSingle()

  if (
    error ||
    profile?.id !== user.id ||
    profile.display_name !== expectedDisplayName ||
    JSON.stringify(sanitizeFocusAreas(profile.focus_areas)) !== JSON.stringify(focusAreas)
  ) {
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
