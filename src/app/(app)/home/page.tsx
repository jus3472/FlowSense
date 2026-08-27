import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LastScore } from '@/components/home/last-score'
import { StreakDisplay } from '@/components/home/streak-display'
import { TrendStrip } from '@/components/home/trend-strip'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { focusPhrase, practiceModePriority, sanitizeFocusAreas } from '@/lib/focus-areas'
import { loadHomeResponseData, logHomeDataFailure } from '@/lib/home/server'
import { formatExpectedDuration, recordHrefForPrompt } from '@/lib/practice/navigation'
import { pickPreferredPracticePrompt } from '@/lib/prompts/server'
import { computeStreak } from '@/lib/streak'
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

  const [profileResult, responseResult] = await Promise.all([
    supabase.from('profiles').select('focus_areas').eq('id', user.id).maybeSingle(),
    loadHomeResponseData(supabase, user.id),
  ])

  const areas = sanitizeFocusAreas(profileResult.data?.focus_areas ?? [])
  const phrase = focusPhrase(areas)
  if (profileResult.error) {
    logHomeDataFailure('profile_preferences', 'query', profileResult.error)
  }
  const historyFailed = responseResult.status === 'failure'
  const responseData = responseResult.status === 'ready' ? responseResult.data : null
  const recommendedOutcome = await pickPreferredPracticePrompt(
    practiceModePriority(areas),
    responseData?.recentPromptIds ?? [],
  )
  const recommendedPrompt = recommendedOutcome.status === 'ready' ? recommendedOutcome.data : null
  const streak = computeStreak(responseData?.timestamps ?? [])
  const latest = responseData?.latest ?? null

  return (
    <div className="flex flex-col gap-12 pt-4 pb-12">
      {historyFailed ? null : <StreakDisplay streak={streak} />}

      {recommendedOutcome.status === 'failure' ? (
        <ErrorState
          title="Your suggested prompt did not load"
          description="The connection to the practice library failed. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      ) : recommendedPrompt ? (
        <div className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4">
          <p className="text-muted text-sm">Suggested prompt</p>
          <p className="text-foreground font-medium">{recommendedPrompt.text}</p>
          <p className="text-muted text-sm">
            {formatExpectedDuration(recommendedPrompt.targetDurationSeconds)}
          </p>
        </div>
      ) : null}
      {recommendedOutcome.status === 'failure' ? null : (
        <ButtonLink
          href={recommendedPrompt ? recordHrefForPrompt(recommendedPrompt.id) : '/practice/custom'}
          size="lg"
          fullWidth
        >
          {recommendedPrompt ? 'Start a response' : 'Enter a custom prompt'}
        </ButtonLink>
      )}
      <ButtonLink href="/practice" variant="secondary" fullWidth>
        Browse practice
      </ButtonLink>

      {historyFailed ? (
        <ErrorState
          title="Your responses did not load"
          description="The connection to your account failed. Your recordings are safe."
        >
          <RetryButton />
        </ErrorState>
      ) : (
        <>
          <LastScore
            attemptId={latest?.attemptId ?? null}
            score={latest?.score ?? null}
            summary={latest?.summary ?? null}
            focusPhrase={phrase}
            unavailable={responseData?.latestUnavailable ?? false}
          />
          <TrendStrip scores={responseData?.scores ?? []} />
        </>
      )}
    </div>
  )
}
