'use server'

import { redirect } from 'next/navigation'
import { customPracticeHandoffSecret } from '@/lib/env/server'
import { sealCustomPracticeHandoff } from '@/lib/practice/custom-handoff'
import { storeCustomPracticeHandoffCookie } from '@/lib/practice/custom-handoff-cookie'
import { validateCustomPracticeInput } from '@/lib/practice/custom'
import { createClient } from '@/lib/supabase/server'

export async function beginCustomPractice(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const target = Number(formData.get('target_duration_seconds'))
  const result = validateCustomPracticeInput({
    promptText: formData.get('prompt'),
    mode: formData.get('mode'),
    additionalContext: formData.get('additional_context'),
    targetDurationSeconds: target,
  })
  if (!result.ok)
    redirect(`/practice/custom?error=${result.reason === 'too_large' ? 'too-large' : 'invalid'}`)
  const handoff = sealCustomPracticeHandoff(result.value, user.id, customPracticeHandoffSecret())
  if (!handoff) redirect('/practice/custom?error=too-large')
  await storeCustomPracticeHandoffCookie(handoff)
  redirect('/record?custom=1')
}
