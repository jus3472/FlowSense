'use server'

import { redirect } from 'next/navigation'
import { clearCustomPracticeHandoffCookie } from '@/lib/practice/custom-handoff-cookie'
import { createClient } from '@/lib/supabase/server'

export async function logOut() {
  await clearCustomPracticeHandoffCookie()
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
