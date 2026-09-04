import type { ReactNode } from 'react'
import { AppHeader } from '@/components/layout/app-header'
import { loadPracticeActivitySummary } from '@/lib/activity/server'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const activityOutcome = user ? await loadPracticeActivitySummary(supabase, user.id) : null
  const activity = activityOutcome?.status === 'ready' ? activityOutcome.data : null

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader activity={activity} />
      <main className="max-w-column mx-auto w-full flex-1 px-6 py-8 sm:py-12">{children}</main>
    </div>
  )
}
