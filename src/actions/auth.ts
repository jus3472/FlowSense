'use server'

import { redirect } from 'next/navigation'
import { logAuthDiagnostic } from '@/lib/auth-diagnostic'
import { clearCustomPracticeHandoffCookie } from '@/lib/practice/custom-handoff-cookie'
import { createClient } from '@/lib/supabase/server'

export async function logOut() {
  let signOutFailed = false
  let signOutError: unknown = null
  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      signOutFailed = true
      signOutError = error
    }
  } catch (error) {
    signOutFailed = true
    signOutError = error
  }

  if (signOutFailed) {
    logAuthDiagnostic('sign_out', signOutError)
    redirect('/settings?logout=failed')
  }

  try {
    await clearCustomPracticeHandoffCookie()
  } catch (error) {
    logAuthDiagnostic('logout_cleanup', error)
  }
  redirect('/login')
}
