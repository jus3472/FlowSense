import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LastScore } from '@/components/home/last-score'
import {
  HomeOtherPractice,
  HomePrimaryPath,
  HomeSecondaryPaths,
} from '@/components/home/path-progress'
import { StreakDisplay } from '@/components/home/streak-display'
import { TrendStrip } from '@/components/home/trend-strip'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { loadPracticeActivitySummary } from '@/lib/activity/server'
import { loadCurriculumOverviewForUser } from '@/lib/curriculum/server'
import { buildHomeCurriculumModel } from '@/lib/home/progression'
import { loadHomeResponseData } from '@/lib/home/server'
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

  const [activityResult, curriculumResult, responseResult] = await Promise.all([
    loadPracticeActivitySummary(supabase, user.id),
    loadCurriculumOverviewForUser(supabase, user.id),
    loadHomeResponseData(supabase, user.id),
  ])
  const curriculum =
    curriculumResult.status === 'ready' ? buildHomeCurriculumModel(curriculumResult.data) : null
  const responseData = responseResult.status === 'ready' ? responseResult.data : null
  const historyErrorDescription =
    responseResult.status === 'failure' && responseResult.reason === 'invalid_response'
      ? 'Your saved response summary could not be read. Try loading it again.'
      : 'The connection to your account failed. Your recordings are safe.'

  return (
    <div className="flex min-w-0 flex-col gap-12 pt-4 pb-12">
      {activityResult.status === 'ready' ? (
        <StreakDisplay summary={activityResult.data} />
      ) : (
        <ErrorState
          title="Your practice days did not load"
          description="Your saved activity is still available. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      )}

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

      <HomeOtherPractice />

      {responseResult.status === 'failure' ? (
        <ErrorState title="Your responses did not load" description={historyErrorDescription}>
          <RetryButton />
        </ErrorState>
      ) : (
        <section aria-labelledby="latest-response-heading" className="flex flex-col gap-4">
          <h2 id="latest-response-heading" className="text-foreground text-lg font-semibold">
            Latest response
          </h2>
          <LastScore
            attemptId={responseData?.latest?.attemptId ?? null}
            score={responseData?.latest?.score ?? null}
            summary={responseData?.latest?.summary ?? null}
            focusPhrase="in practice"
            unavailable={responseData?.latestUnavailable ?? false}
          />
          <TrendStrip scores={responseData?.scores ?? []} />
        </section>
      )}
    </div>
  )
}
