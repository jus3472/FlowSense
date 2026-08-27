'use server'

import { redirect } from 'next/navigation'
import type { AuthFormState } from '@/lib/forms'
import { clearCustomPracticeHandoffCookie } from '@/lib/practice/custom-handoff-cookie'
import { createClient } from '@/lib/supabase/server'
import { isAuthMode, validateEmail, validatePassword, type AuthMode } from '@/lib/validation'

/** Maps Supabase auth failures onto messages that say what to do next. */
function messageFor(mode: AuthMode, raw: string): string {
  const text = raw.toLowerCase()
  if (text.includes('already registered') || text.includes('already been registered')) {
    return 'That email is already registered. Switch to log in.'
  }
  if (text.includes('invalid login credentials')) {
    return 'Your email or password is not correct.'
  }
  if (text.includes('email not confirmed')) {
    return 'Confirm your email address, then log in.'
  }
  if (text.includes('rate limit') || text.includes('too many')) {
    return 'Too many attempts. Wait 60 seconds and try again.'
  }
  return mode === 'signup'
    ? 'Your account could not be created. Try again.'
    : 'You could not be logged in. Try again.'
}

export async function authenticate(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const rawMode = formData.get('mode')
  const mode: AuthMode = isAuthMode(rawMode) ? rawMode : 'login'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const emailError = validateEmail(email)
  const passwordError = validatePassword(password, mode)
  if (emailError || passwordError) {
    return {
      formError: null,
      notice: null,
      fieldErrors: {
        ...(emailError ? { email: emailError } : {}),
        ...(passwordError ? { password: passwordError } : {}),
      },
    }
  }

  const supabase = await createClient()

  if (mode === 'signup') {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      return { formError: messageFor(mode, error.message), notice: null, fieldErrors: {} }
    }
    if (!data.session) {
      // Only reachable if email confirmation gets turned on for the project.
      return {
        formError: null,
        notice: 'Check your email for a confirmation link, then log in.',
        fieldErrors: {},
      }
    }
    await clearCustomPracticeHandoffCookie()
    redirect('/onboarding')
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return { formError: messageFor(mode, error.message), notice: null, fieldErrors: {} }
  }
  await clearCustomPracticeHandoffCookie()
  redirect('/home')
}
