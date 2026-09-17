import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FocusStep } from '@/components/onboarding/focus-step'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Your practice tracks',
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

  return <FocusStep error={error === 'save'} />
}
