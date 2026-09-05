'use server'

import { revalidatePath } from 'next/cache'
import type { ProfileFormState } from '@/lib/forms'
import { createClient } from '@/lib/supabase/server'
import { isValidIanaTimezone, safeTimezone } from '@/lib/timezone'
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
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('profiles')
    .select('id, timezone')
    .eq('id', user.id)
    .maybeSingle()
  if (existingProfileError) {
    return {
      status: 'error',
      message: 'Your changes did not save. Check your connection and try again.',
      displayNameError: null,
    }
  }
  const timezone = isValidIanaTimezone(existingProfile?.timezone)
    ? existingProfile.timezone
    : safeTimezone(formData.get('timezone'))
  const { data: profile, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        display_name: expectedDisplayName,
        timezone,
      },
      { onConflict: 'id' },
    )
    .select('id, display_name, timezone')
    .maybeSingle()

  if (
    error ||
    profile?.id !== user.id ||
    profile.display_name !== expectedDisplayName ||
    profile.timezone !== timezone
  ) {
    return {
      status: 'error',
      message: 'Your changes did not save. Check your connection and try again.',
      displayNameError: null,
    }
  }

  revalidatePath('/settings')
  return { status: 'saved', message: 'Saved.', displayNameError: null }
}
