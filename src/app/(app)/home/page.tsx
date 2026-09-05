import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HomePrimaryPath, HomeSecondaryPaths } from '@/components/home/path-progress'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'
import { loadCurriculumOverviewForUser } from '@/lib/curriculum/server'
import { buildHomeCurriculumModel } from '@/lib/home/progression'
import {
  loadRecentStructuredLessonId,
  logRecentStructuredLessonFailure,
} from '@/lib/home/recent-lesson'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Home',
}

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [curriculumResult, recentLessonResult] = await Promise.all([
    loadCurriculumOverviewForUser(supabase, user.id),
    loadRecentStructuredLessonId(supabase, user.id),
  ])
  if (recentLessonResult.status === 'failure') {
    logRecentStructuredLessonFailure(recentLessonResult)
  }
  const curriculum =
    curriculumResult.status === 'ready'
      ? buildHomeCurriculumModel(
          curriculumResult.data,
          recentLessonResult.status === 'ready' ? recentLessonResult.lessonId : null,
        )
      : null

  return (
    <PageShell width="column">
      <PageTitle>Home</PageTitle>
      {curriculum ? (
        <>
          <HomePrimaryPath primary={curriculum.primary} />
          <HomeSecondaryPaths paths={curriculum.secondary} />
        </>
      ) : (
        <ErrorState
          title="Your path did not load"
          description="Your lesson progress is still saved. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      )}
    </PageShell>
  )
}
