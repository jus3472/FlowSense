import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import { AudioPlayer } from '@/components/record/audio-player'
import { ResultsView } from '@/components/results/results-view'
import { V2ResultsView } from '@/components/results/v2-results-view'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { logAttemptDiagnostic } from '@/lib/attempts/server'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { readAttemptResult } from '@/lib/results/attempt-result'
import { compareRetryResults, loadRetryAncestorChain } from '@/lib/results/retry-comparison'
import { createClient } from '@/lib/supabase/server'
import type { AttemptRow } from '@/lib/types/database'

export const metadata: Metadata = {
  title: 'Your answer',
}

const SIGNED_URL_SECONDS = 60 * 60
type RetryAttemptRow = Pick<
  AttemptRow,
  | 'id'
  | 'prompt_text'
  | 'transcript'
  | 'duration_ms'
  | 'created_at'
  | 'score'
  | 'section_scores'
  | 'metrics'
  | 'content_result'
  | 'retry_of_attempt_id'
>
type RetryAttempt = RetryAttemptRow & { retryOfAttemptId: string | null }

function resultLoadError() {
  return (
    <ErrorState
      title="Result unavailable"
      description="Your result could not be loaded. Try again in a moment."
    >
      <RetryButton />
    </ErrorState>
  )
}

function resultWithAudioStatus(content: ReactNode, audioUnavailable: boolean) {
  return (
    <div className="flex flex-col gap-4">
      {audioUnavailable ? (
        <p role="status" className="text-muted text-sm">
          Audio playback is unavailable for this response.
        </p>
      ) : null}
      {content}
    </div>
  )
}

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let attemptResponse
  try {
    attemptResponse = await supabase
      .from('attempts')
      .select(
        'id, prompt_text, transcript, duration_ms, audio_path, created_at, score, section_scores, metrics, content_result, retry_of_attempt_id',
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
  } catch {
    logAttemptDiagnostic('load_attempt_result', 'attempt_result_read_failed', null)
    return resultLoadError()
  }

  const { data: attempt, error: attemptError } = attemptResponse
  if (attemptError) {
    logAttemptDiagnostic('load_attempt_result', 'attempt_result_read_failed', null)
    return resultLoadError()
  }

  if (!attempt) notFound()

  let audioUrl: string | null = null
  let audioUnavailable = false
  if (attempt.audio_path) {
    try {
      const { data, error } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .createSignedUrl(attempt.audio_path, SIGNED_URL_SECONDS)
      if (error || !data?.signedUrl) {
        audioUnavailable = true
        logAttemptDiagnostic('sign_attempt_result_audio', 'signed_audio_url_failed', null)
      } else {
        audioUrl = data.signedUrl
      }
    } catch {
      audioUnavailable = true
      logAttemptDiagnostic('sign_attempt_result_audio', 'signed_audio_url_failed', null)
    }
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
    return resultWithAudioStatus(
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
      </div>,
      audioUnavailable,
    )
  }

  if (result.kind === 'v2') {
    // Every ancestor read is user-scoped. A missing, cyclic, or overlong chain
    // suppresses the link and comparison rather than reconstructing history.
    let comparison = null
    let previousAttemptId: string | null = null
    if (attempt.retry_of_attempt_id) {
      let chain: readonly RetryAttempt[] | null = null
      try {
        chain = await loadRetryAncestorChain<RetryAttempt>(attempt.id, async (ancestorId) => {
          if (ancestorId === attempt.id) {
            return {
              id: attempt.id,
              prompt_text: attempt.prompt_text,
              transcript: attempt.transcript,
              duration_ms: attempt.duration_ms,
              created_at: attempt.created_at,
              score: attempt.score,
              section_scores: attempt.section_scores,
              metrics: attempt.metrics,
              content_result: attempt.content_result,
              retry_of_attempt_id: attempt.retry_of_attempt_id,
              retryOfAttemptId: attempt.retry_of_attempt_id,
            }
          }
          const response: { data: RetryAttemptRow | null; error: unknown } = await supabase
            .from('attempts')
            .select(
              'id, prompt_text, transcript, duration_ms, created_at, score, section_scores, metrics, content_result, retry_of_attempt_id',
            )
            .eq('id', ancestorId)
            .eq('user_id', user.id)
            .maybeSingle()
          if (response.error) {
            throw new Error('Retry ancestor query failed.')
          }
          return response.data
            ? { ...response.data, retryOfAttemptId: response.data.retry_of_attempt_id }
            : null
        })
      } catch {
        logAttemptDiagnostic('load_retry_ancestor', 'retry_ancestor_read_failed', null)
        chain = null
      }
      const parent = chain?.[0] ?? null
      if (parent) {
        previousAttemptId = parent.id
        const parentResult = readAttemptResult({
          id: parent.id,
          promptText: parent.prompt_text,
          transcript: parent.transcript,
          durationMs: parent.duration_ms,
          createdAt: parent.created_at,
          audioUrl: null,
          score: parent.score,
          sectionScores: parent.section_scores,
          metrics: parent.metrics,
          contentResult: parent.content_result,
        })
        comparison = compareRetryResults(
          result.payload,
          parentResult.kind === 'v2' ? parentResult.payload : null,
        )
      }
    }
    const additionalContext =
      typeof attempt.metrics === 'object' &&
      attempt.metrics !== null &&
      !Array.isArray(attempt.metrics) &&
      typeof (attempt.metrics as { practice?: { additional_context?: unknown } }).practice
        ?.additional_context === 'string'
        ? (attempt.metrics as { practice: { additional_context: string } }).practice
            .additional_context
        : null
    return resultWithAudioStatus(
      <V2ResultsView
        attemptId={attempt.id}
        promptText={attempt.prompt_text}
        additionalContext={additionalContext}
        transcript={attempt.transcript ?? ''}
        durationMs={durationMs}
        audioUrl={audioUrl}
        payload={result.payload}
        comparison={comparison}
        previousAttemptId={previousAttemptId}
      />,
      audioUnavailable,
    )
  }

  if (result.kind !== 'legacy') {
    return resultWithAudioStatus(
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
      </div>,
      audioUnavailable,
    )
  }

  // Disputes live in note_feedback and are re-applied on every read, so the
  // stored findings stay intact and a kept one can dim in place.
  let disputeResponse
  try {
    disputeResponse = await supabase
      .from('note_feedback')
      .select('note_type, quote')
      .eq('attempt_id', id)
      .eq('user_id', user.id)
  } catch {
    logAttemptDiagnostic('load_result_disputes', 'result_disputes_read_failed', null)
    return resultLoadError()
  }
  const { data: disputeRows, error: disputeError } = disputeResponse
  if (disputeError) {
    logAttemptDiagnostic('load_result_disputes', 'result_disputes_read_failed', null)
    return resultLoadError()
  }

  return resultWithAudioStatus(
    <ResultsView
      attempt={result.attempt}
      initialDisputes={(disputeRows ?? []).map((row) => ({
        note_type: row.note_type,
        quote: row.quote,
      }))}
    />,
    audioUnavailable,
  )
}
