import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AudioPlayer } from '@/components/record/audio-player'
import { ResultsView } from '@/components/results/results-view'
import { V2ResultsView } from '@/components/results/v2-results-view'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { readAttemptResult } from '@/lib/results/attempt-result'
import { createClient } from '@/lib/supabase/server'

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

  const durationMs = attempt.duration_ms ?? 0
  const result = readAttemptResult({
    id: attempt.id,
    promptText: attempt.prompt_text,
    transcript: attempt.transcript,
    durationMs: attempt.duration_ms,
    createdAt: attempt.created_at,
    audioUrl,
    score: attempt.score,
    sectionScores: attempt.section_scores,
    metrics: attempt.metrics,
    contentResult: attempt.content_result,
  })

  // A recording that never finished scoring still shows what it does have.
  if (result.kind === 'incomplete') {
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
        <ButtonLink href={`/record?retry=${attempt.id}`} size="lg" fullWidth>
          Try this prompt again
        </ButtonLink>
      </div>
    )
  }

  if (result.kind === 'v2') {
    const additionalContext =
      typeof attempt.metrics === 'object' &&
      attempt.metrics !== null &&
      !Array.isArray(attempt.metrics) &&
      typeof (attempt.metrics as { practice?: { additional_context?: unknown } }).practice
        ?.additional_context === 'string'
        ? (attempt.metrics as { practice: { additional_context: string } }).practice
            .additional_context
        : null
    return (
      <V2ResultsView
        attemptId={attempt.id}
        promptText={attempt.prompt_text}
        additionalContext={additionalContext}
        transcript={attempt.transcript ?? ''}
        durationMs={durationMs}
        audioUrl={audioUrl}
        payload={result.payload}
      />
    )
  }

  if (result.kind !== 'legacy') {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-foreground text-xl font-semibold">{attempt.prompt_text}</h1>
        {audioUrl ? <AudioPlayer src={audioUrl} durationMs={durationMs} /> : null}
        <Card>
          <EmptyState
            title="Result unavailable"
            description="This response uses a result format that is not available here yet."
          />
        </Card>
        <ButtonLink href={`/record?retry=${attempt.id}`} size="lg" fullWidth>
          Try this prompt again
        </ButtonLink>
      </div>
    )
  }

  // Disputes live in note_feedback and are re-applied on every read, so the
  // stored findings stay intact and a kept one can dim in place.
  const { data: disputeRows } = await supabase
    .from('note_feedback')
    .select('note_type, quote')
    .eq('attempt_id', id)

  return (
    <ResultsView
      attempt={result.attempt}
      initialDisputes={(disputeRows ?? []).map((row) => ({
        note_type: row.note_type,
        quote: row.quote,
      }))}
    />
  )
}
