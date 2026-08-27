import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ProgressDashboard } from '@/components/progress/progress-dashboard'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { parseProgressMode } from '@/lib/progress/display'
import { getProgressDashboardData } from '@/lib/progress/server'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Progress' }
export const dynamic = 'force-dynamic'

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>
}) {
  const parsed = parseProgressMode((await searchParams).mode)
  if (parsed.status === 'invalid') redirect('/progress')

  const {
    data: { user },
  } = await (await createClient()).auth.getUser()
  if (!user) redirect('/login')
  const mode = parsed.mode
  const result = await getProgressDashboardData(user.id, { now: new Date(), mode })

  if (result.status === 'failure') {
    return (
      <ErrorState
        title="Progress is unavailable"
        description="Your progress could not be loaded. Try again in a moment."
      >
        <RetryButton />
      </ErrorState>
    )
  }

  return <ProgressDashboard dashboard={result.data} mode={mode} />
}
