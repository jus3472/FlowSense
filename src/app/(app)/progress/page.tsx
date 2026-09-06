import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ProgressDashboard } from '@/components/progress/progress-dashboard'
import { parseProgressFilter } from '@/lib/progress/display'
import { getProgressDashboardData } from '@/lib/progress/server'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Progress' }
export const dynamic = 'force-dynamic'

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>
}) {
  const parsed = parseProgressFilter((await searchParams).mode)
  if (parsed.status === 'invalid') redirect('/progress')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const result = await getProgressDashboardData(user.id, {
    now: new Date(),
    filter: parsed.filter,
  })

  return (
    <ProgressDashboard
      dashboard={result.status === 'ready' ? result.data : null}
      filter={parsed.filter}
    />
  )
}
