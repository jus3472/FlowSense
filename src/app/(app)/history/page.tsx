import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HistoryList } from '@/components/history/history-list'
import { focusPhrase, sanitizeFocusAreas } from '@/lib/focus-areas'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import type { HistoryEntry } from '@/lib/results/history'
import { deductionLine, largestDeduction } from '@/lib/results/summary'
import { CONTENT_POINTS, type CheckName } from '@/lib/scoring/content'
import type { DeliveryMetricName, MetricResult } from '@/lib/scoring/mechanical'
import { createClient } from '@/lib/supabase/server'
import type { AttemptMetrics } from '@/lib/types/metrics'

export const metadata: Metadata = {
  title: 'History',
}

export const dynamic = 'force-dynamic'

export default async function HistoryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileResult, attemptsResult] = await Promise.all([
    supabase.from('profiles').select('focus_areas').eq('id', user.id).maybeSingle(),
    supabase
      .from('attempts')
      .select(
        'id, created_at, prompt_text, duration_ms, audio_path, score, section_scores, metrics',
      )
      .eq('user_id', user.id)
      .not('score', 'is', null)
      .order('created_at', { ascending: false })
      .limit(60),
  ])

  const phrase = focusPhrase(sanitizeFocusAreas(profileResult.data?.focus_areas ?? []))

  const entries: HistoryEntry[] = []
  for (const attempt of attemptsResult.data ?? []) {
    if (attempt.score === null) continue

    let audioUrl: string | null = null
    if (attempt.audio_path) {
      const { data } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .createSignedUrl(attempt.audio_path, 60 * 60)
      audioUrl = data?.signedUrl ?? null
    }

    const delivery = (attempt.metrics as AttemptMetrics | null)?.delivery
    const sections = attempt.section_scores as {
      content?: { checks?: Record<CheckName, number> }
    } | null

    entries.push({
      id: attempt.id,
      createdAt: attempt.created_at,
      promptText: attempt.prompt_text,
      score: attempt.score,
      summary: delivery
        ? deductionLine(
            largestDeduction(
              delivery.metrics as Record<DeliveryMetricName, MetricResult>,
              sections?.content?.checks ?? null,
              CONTENT_POINTS,
            ),
          )
        : 'Not scored',
      audioUrl,
      durationMs: attempt.duration_ms ?? 0,
    })
  }

  return (
    <div className="flex flex-col gap-12 pt-4 pb-12">
      <h1 className="prompt-display text-foreground text-2xl">Your history</h1>
      <HistoryList entries={entries} focusPhrase={phrase} />
    </div>
  )
}
