'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { CUSTOM_SESSION_COOKIE, parseCustomPracticeInput, serializeCustomPracticeInput } from '@/lib/practice/custom'
import { createClient } from '@/lib/supabase/server'

export async function beginCustomPractice(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const target = Number(formData.get('target_duration_seconds'))
  const input = parseCustomPracticeInput({ promptText: formData.get('prompt'), mode: formData.get('mode'), additionalContext: formData.get('additional_context'), targetDurationSeconds: target })
  if (!input) redirect('/practice/custom?error=invalid')
  ;(await cookies()).set(CUSTOM_SESSION_COOKIE, serializeCustomPracticeInput(input), { httpOnly: true, sameSite: 'lax', secure: true, path: '/record', maxAge: 5 * 60 })
  redirect('/record')
}
