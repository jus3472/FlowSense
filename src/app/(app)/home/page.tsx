import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LastScore } from '@/components/home/last-score'
import { StreakDisplay } from '@/components/home/streak-display'
import { TrendStrip } from '@/components/home/trend-strip'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { focusPhrase, sanitizeFocusAreas } from '@/lib/focus-areas'
import { largestDeduction, summariseAttempt } from '@/lib/results/summary'
import { CONTENT_POINTS, type CheckName } from '@/lib/scoring/content'
import type { DeliveryMetricName, MetricResult } from '@/lib/scoring/mechanical'
import { computeStreak } from '@/lib/streak'
import { createClient } from '@/lib/supabase/server'
import type { AttemptMetrics } from '@/lib/types/metrics'

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
      .select('id, created_at, score, section_scores, metrics')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  const areas = sanitizeFocusAreas(profileResult.data?.focus_areas ?? [])
  const phrase = focusPhrase(areas)

  const historyFailed = Boolean(attemptsResult.error)
  const attempts = attemptsResult.data ?? []
  const streak = computeStreak(attempts.map((attempt) => attempt.created_at))
  const scores = attempts
    .map((attempt) => attempt.score)
    .filter((score): score is number => score !== null)
    .reverse()

  const latest = attempts.find((attempt) => attempt.score !== null) ?? null
  let summary: string | null = null
  if (latest?.score !== null && latest) {
    const delivery = (latest.metrics as AttemptMetrics | null)?.delivery
    const sections = latest.section_scores as {
      content?: { checks?: Record<CheckName, number> }
    } | null
    if (delivery) {
      summary = summariseAttempt(
        latest.score,
        largestDeduction(
          delivery.metrics as Record<DeliveryMetricName, MetricResult>,
          sections?.content?.checks ?? null,
          CONTENT_POINTS,
        ),
      )
    }
  }

  return (
    <div className="flex flex-col gap-12 pt-4 pb-12">
      {historyFailed ? null : <StreakDisplay streak={streak} />}

      <ButtonLink href="/record" size="lg" fullWidth>
        Start a response
      </ButtonLink>
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
            attemptId={latest?.id ?? null}
            score={latest?.score ?? null}
            summary={summary}
            focusPhrase={phrase}
          />
          <TrendStrip scores={scores} />
        </>
      )}
    </div>
  )
}
