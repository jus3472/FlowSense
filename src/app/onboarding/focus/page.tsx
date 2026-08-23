import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FocusStep } from '@/components/onboarding/focus-step'
import { sanitizeFocusAreas } from '@/lib/focus-areas'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Focus areas',
}

export default async function FocusPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('focus_areas')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <FocusStep
      initialSelected={sanitizeFocusAreas(profile?.focus_areas ?? [])}
      saveFailed={error === 'save'}
    />
  )
}
