import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ProgressDashboard } from '@/components/progress/progress-dashboard'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { loadCurriculumOverviewForUser } from '@/lib/curriculum/server'
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

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const mode = parsed.mode
  const [speakingResult, curriculumResult] = await Promise.all([
    getProgressDashboardData(user.id, { now: new Date(), mode }),
    loadCurriculumOverviewForUser(supabase, user.id),
  ])

  if (speakingResult.status === 'failure' && curriculumResult.status !== 'ready') {
    return (
      <ErrorState
        title="Progress is unavailable"
        description="Your progress could not be loaded. Try again in a moment."
      >
        <RetryButton />
      </ErrorState>
    )
  }

  return (
    <ProgressDashboard
      dashboard={speakingResult.status === 'ready' ? speakingResult.data : null}
      curriculum={curriculumResult.status === 'ready' ? curriculumResult.data : null}
      curriculumUnavailable={curriculumResult.status !== 'ready'}
      mode={mode}
    />
  )
}
