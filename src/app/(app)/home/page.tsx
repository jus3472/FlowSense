import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LastScore } from '@/components/home/last-score'
import { StreakDisplay } from '@/components/home/streak-display'
import { TrendStrip } from '@/components/home/trend-strip'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { focusPhrase, sanitizeFocusAreas } from '@/lib/focus-areas'
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

  const [profileResult, attemptsResult] = await Promise.all([
    supabase.from('profiles').select('focus_areas').eq('id', user.id).maybeSingle(),
    supabase
      .from('attempts')
      .select('created_at, score')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  const areas = sanitizeFocusAreas(profileResult.data?.focus_areas ?? [])
  const phrase = focusPhrase(areas)

  const historyFailed = Boolean(attemptsResult.error)
  const attempts = attemptsResult.data ?? []
  const streak = computeStreak(attempts.map((attempt) => attempt.created_at))
  const latest = attempts[0] ?? null
  const scores = attempts
    .map((attempt) => attempt.score)
    .filter((score): score is number => score !== null)
    .reverse()

  return (
    <div className="flex flex-col gap-8">
      {historyFailed ? null : <StreakDisplay streak={streak} />}

      <ButtonLink href="/record" size="lg" fullWidth>
        {"Start today's response"}
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
            score={latest?.score ?? null}
            recordedAt={latest?.created_at ?? null}
            focusPhrase={phrase}
          />
          <TrendStrip scores={scores} />
        </>
      )}
    </div>
  )
}
