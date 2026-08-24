import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AudioPlayer } from '@/components/record/audio-player'
import { ResultsView } from '@/components/results/results-view'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import type { StoredContentResult } from '@/lib/scoring/assemble'
import type { AttemptView } from '@/lib/results/types'
import { createClient } from '@/lib/supabase/server'
import type { AttemptMetrics } from '@/lib/types/metrics'

export const metadata: Metadata = {
  title: 'Your answer',
}

const SIGNED_URL_SECONDS = 60 * 60

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: attempt } = await supabase
    .from('attempts')
    .select(
      'id, prompt_text, transcript, duration_ms, audio_path, created_at, score, section_scores, metrics, content_result',
    )
    .eq('id', id)
    .maybeSingle()

  if (!attempt) notFound()

  let audioUrl: string | null = null
  if (attempt.audio_path) {
    const { data } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(attempt.audio_path, SIGNED_URL_SECONDS)
    audioUrl = data?.signedUrl ?? null
  }

  const metrics = (attempt.metrics as AttemptMetrics | null) ?? {}
  const delivery = metrics.delivery
  const durationMs = attempt.duration_ms ?? 0

  // A recording that never finished scoring still shows what it does have.
  if (attempt.score === null || !delivery || !attempt.section_scores || !attempt.content_result) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-foreground text-xl font-semibold">{attempt.prompt_text}</h1>
        {audioUrl ? <AudioPlayer src={audioUrl} durationMs={durationMs} /> : null}
        <Card>
          <EmptyState
            title="Not scored yet"
            description="This response was saved but never scored. Record another and it will be scored automatically."
          />
        </Card>
        <ButtonLink href="/record" size="lg" fullWidth>
          {"Start today's response"}
        </ButtonLink>
      </div>
    )
  }

  const view: AttemptView = {
    id: attempt.id,
    promptText: attempt.prompt_text,
    transcript: attempt.transcript ?? '',
    durationMs,
    createdAt: attempt.created_at,
    audioUrl,
    score: attempt.score,
    sections: attempt.section_scores as unknown as AttemptView['sections'],
    metrics: delivery.metrics as AttemptView['metrics'],
    statistics: delivery.statistics as AttemptView['statistics'],
    pauses: delivery.pauses as AttemptView['pauses'],
    words: metrics.transcript?.words ?? [],
    content: attempt.content_result as unknown as StoredContentResult,
  }

  // Disputes live in note_feedback and are re-applied on every read, so the
  // stored findings stay intact and a kept one can dim in place.
  const { data: disputeRows } = await supabase
    .from('note_feedback')
    .select('note_type, quote')
    .eq('attempt_id', id)

  return (
    <ResultsView
      attempt={view}
      initialDisputes={(disputeRows ?? []).map((row) => ({
        note_type: row.note_type,
        quote: row.quote,
      }))}
    />
  )
}
