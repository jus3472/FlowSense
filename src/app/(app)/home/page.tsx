import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LastScore } from '@/components/home/last-score'
import { StreakDisplay } from '@/components/home/streak-display'
import { TrendStrip } from '@/components/home/trend-strip'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { focusPhrase, practiceModePriority, sanitizeFocusAreas } from '@/lib/focus-areas'
import { formatExpectedDuration, recordHrefForPrompt } from '@/lib/practice/navigation'
import { recentCompletedLibraryPromptIds } from '@/lib/prompts/selection'
import { pickPreferredPracticePrompt } from '@/lib/prompts/server'
import { legacyAttemptForHome } from '@/lib/results/attempt-result'
import { largestDeduction, summariseAttempt } from '@/lib/results/summary'
import { CONTENT_POINTS } from '@/lib/scoring/content'
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

  const [profileResult, attemptsResult, latestResult] = await Promise.all([
    supabase.from('profiles').select('focus_areas').eq('id', user.id).maybeSingle(),
    supabase
      .from('attempts')
      .select(
        'id, prompt_id, prompt_text, prompt_source, transcript, duration_ms, created_at, score, section_scores, metrics, content_result',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('attempts')
      .select(
        'id, prompt_text, transcript, duration_ms, created_at, score, section_scores, metrics, content_result',
      )
      .eq('user_id', user.id)
      .or('score.not.is.null,section_scores.not.is.null')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const areas = sanitizeFocusAreas(profileResult.data?.focus_areas ?? [])
  const phrase = focusPhrase(areas)

  const historyFailed = Boolean(attemptsResult.error || latestResult.error)
  if (historyFailed) {
    console.error('[home] response data load failed', {
      recentHistoryCode: attemptsResult.error?.code ?? null,
      recentHistoryMessage: attemptsResult.error?.message ?? null,
      latestAttemptCode: latestResult.error?.code ?? null,
      latestAttemptMessage: latestResult.error?.message ?? null,
    })
  }
  const attempts = attemptsResult.data ?? []
  const recommendedOutcome = await pickPreferredPracticePrompt(
    practiceModePriority(areas),
    historyFailed ? [] : recentCompletedLibraryPromptIds(attempts),
  )
  const recommendedPrompt = recommendedOutcome.status === 'ready' ? recommendedOutcome.data : null
  const streak = computeStreak(attempts.map((attempt) => attempt.created_at))
  const scores = attempts
    .map((attempt) => attempt.score)
    .filter((score): score is number => score !== null)
    .reverse()

  const latest = latestResult.data
  let summary: string | null = null
  if (latest && latest.score !== null) {
    const legacy = legacyAttemptForHome({
      id: latest.id,
      promptText: latest.prompt_text,
      transcript: latest.transcript,
      durationMs: latest.duration_ms,
      createdAt: latest.created_at,
      audioUrl: null,
      score: latest.score,
      sectionScores: latest.section_scores,
      metrics: latest.metrics,
      contentResult: latest.content_result,
    })
    if (legacy) {
      summary = summariseAttempt(
        latest.score,
        largestDeduction(legacy.metrics, legacy.sections.content.checks, CONTENT_POINTS),
      )
    }
  }

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
