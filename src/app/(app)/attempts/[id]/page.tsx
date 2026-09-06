import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import { AudioPlayer } from '@/components/record/audio-player'
import { V3ResultsView } from '@/components/results/v3-results-view'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { validateOwnedAttemptAudioPath } from '@/lib/attempts/audio-path'
import {
  ATTEMPT_FAILURE_CODES,
  isActiveAttemptStatus,
  isRetryableAttemptStatus,
  type AttemptStatus,
} from '@/lib/attempts/lifecycle'
import { reconcileCurrentUserStaleAttempts } from '@/lib/attempts/reconciliation'
import { attemptRetryHref } from '@/lib/attempts/retry-href'
import { logAttemptDiagnostic } from '@/lib/attempts/server'
import { loadStructuredLessonResultForUser } from '@/lib/curriculum/result-server'
import { isUuid } from '@/lib/practice/session'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { readAttemptResult, storedTranscriptWords } from '@/lib/results/attempt-result'
import { loadLessonAttemptHistoryForUser } from '@/lib/results/lesson-attempt-history'
import { compareV3RetryResults, loadRetryAncestorChain } from '@/lib/results/retry-comparison'
import { createClient } from '@/lib/supabase/server'
import { safeTimezone, UTC_TIMEZONE } from '@/lib/timezone'
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
    <div className="max-w-column mx-auto flex w-full flex-col gap-4">
      {audioUnavailable ? (
        <p role="status" className="text-muted text-sm">
          Audio playback is unavailable for this response.
        </p>
      ) : null}
      {content}
    </div>
  )
}

const PROCESSING_DESCRIPTION: Record<
  Extract<AttemptStatus, 'uploading' | 'transcribing' | 'scoring'>,
  string
> = {
  uploading: 'Your recording is still being saved.',
  transcribing: 'Your transcript is still being prepared.',
  scoring: 'Your response is still being scored.',
}

function processingResult(promptText: string, status: keyof typeof PROCESSING_DESCRIPTION) {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-foreground text-xl font-semibold">{promptText}</h1>
      <Card>
        <EmptyState
          title="Your response is processing"
          description={`${PROCESSING_DESCRIPTION[status]} Refresh to check again.`}
        />
      </Card>
      <RetryButton>Refresh result</RetryButton>
    </div>
  )
}

function abandonedUploadResult(promptText: string, retryHref: ReturnType<typeof attemptRetryHref>) {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-foreground text-xl font-semibold">{promptText}</h1>
      <Card>
        <EmptyState
          title="Recording not saved"
          description="This recording did not finish saving. Try the same prompt again, or delete this entry from History."
        />
      </Card>
      <div className="flex flex-col gap-3">
        {retryHref ? (
          <ButtonLink href={retryHref} size="lg" fullWidth>
            Try this prompt again
          </ButtonLink>
        ) : null}
        <ButtonLink href="/history" variant="ghost" fullWidth>
          Go to History
        </ButtonLink>
      </div>
    </div>
  )
}

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await reconcileCurrentUserStaleAttempts(user.id, { attemptId: id })

  let attemptResponse
  try {
    attemptResponse = await supabase
      .from('attempts')
      .select(
        'id, prompt_id, lesson_id, prompt_text, transcript, duration_ms, audio_path, created_at, score, section_scores, metrics, content_result, practice_mode, rubric_version, retry_of_attempt_id, status, failure_code',
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
  } catch (error) {
    logAttemptDiagnostic('load_attempt_result', 'attempt_result_read_failed', id, error)
    return resultLoadError()
  }

  const { data: attempt, error: attemptError } = attemptResponse
  if (attemptError) {
    logAttemptDiagnostic('load_attempt_result', 'attempt_result_read_failed', id, attemptError)
    return resultLoadError()
  }

  if (!attempt) notFound()

  if (isActiveAttemptStatus(attempt.status)) {
    return processingResult(attempt.prompt_text, attempt.status)
  }
  if (!isRetryableAttemptStatus(attempt.status)) {
    logAttemptDiagnostic('load_attempt_result', 'attempt_status_invalid', attempt.id)
    return resultLoadError()
  }
  const retryHref = attemptRetryHref({
    attemptId: attempt.id,
    lessonId: attempt.lesson_id,
    metrics: attempt.metrics,
  })
  if (attempt.failure_code === ATTEMPT_FAILURE_CODES.clientUploadAbandoned) {
    return abandonedUploadResult(attempt.prompt_text, retryHref)
  }

  let audioUrl: string | null = null
  let audioUnavailable = false
  if (attempt.audio_path) {
    const ownedAudio = validateOwnedAttemptAudioPath({
      userId: user.id,
      attemptId: attempt.id,
      audioPath: attempt.audio_path,
      metrics: attempt.metrics,
    })
    if (!ownedAudio) {
      audioUnavailable = true
      logAttemptDiagnostic('sign_attempt_result_audio', 'audio_path_invalid', attempt.id)
    } else {
      try {
        const { data, error } = await supabase.storage
          .from(RECORDINGS_BUCKET)
          .createSignedUrl(ownedAudio.storagePath, SIGNED_URL_SECONDS)
        if (error || !data?.signedUrl) {
          audioUnavailable = true
          if (error) {
            logAttemptDiagnostic(
              'sign_attempt_result_audio',
              'signed_audio_url_failed',
              attempt.id,
              error,
            )
          } else {
            logAttemptDiagnostic('sign_attempt_result_audio', 'signed_audio_url_failed', attempt.id)
          }
        } else {
          audioUrl = data.signedUrl
        }
      } catch (error) {
        audioUnavailable = true
        logAttemptDiagnostic(
          'sign_attempt_result_audio',
          'signed_audio_url_failed',
          attempt.id,
          error,
        )
      }
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
        {retryHref ? (
          <ButtonLink href={retryHref} size="lg" fullWidth>
            Try this prompt again
          </ButtonLink>
        ) : null}
      </div>,
      audioUnavailable,
    )
  }

  const loadPreviousAttempts = async () => {
    if (!attempt.lesson_id) return []
    const history = await loadLessonAttemptHistoryForUser(
      supabase,
      user.id,
      attempt.lesson_id,
      attempt.id,
    )
    if (history.status === 'failure') {
      logAttemptDiagnostic(
        'load_lesson_attempt_history',
        'lesson_attempt_history_read_failed',
        attempt.id,
        history.error,
      )
      return []
    }
    return history.data
  }

  const loadResultTimezone = async () => {
    if (!attempt.lesson_id) return UTC_TIMEZONE
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', user.id)
        .maybeSingle()
      if (error) {
        logAttemptDiagnostic(
          'load_result_timezone',
          'profile_timezone_read_failed',
          attempt.id,
          error,
        )
        return UTC_TIMEZONE
      }
      return safeTimezone(data?.timezone)
    } catch (error) {
      logAttemptDiagnostic(
        'load_result_timezone',
        'profile_timezone_read_failed',
        attempt.id,
        error,
      )
      return UTC_TIMEZONE
    }
  }

  if (result.kind === 'v3') {
    let comparison = null
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
          if (response.error) throw response.error
          return response.data
            ? { ...response.data, retryOfAttemptId: response.data.retry_of_attempt_id }
            : null
        })
      } catch (error) {
        logAttemptDiagnostic('load_retry_ancestor', 'retry_ancestor_read_failed', attempt.id, error)
      }
      const parent = chain?.[0] ?? null
      if (parent) {
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
        comparison = compareV3RetryResults(
          result.payload,
          parentResult.kind === 'v3' ? parentResult.payload : null,
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
    const previousAttemptsPromise = loadPreviousAttempts()
    const timezonePromise = loadResultTimezone()
    const curriculumResult = attempt.lesson_id
      ? await loadStructuredLessonResultForUser(supabase, user.id, {
          lessonId: attempt.lesson_id,
          attemptId: attempt.id,
          promptId: attempt.prompt_id,
          practiceMode: attempt.practice_mode,
          rubricVersion: attempt.rubric_version,
          currentScore: attempt.score,
          snapshotMode: result.payload.mode,
          snapshotRubricVersion: result.payload.rubric_version,
          snapshotScore: result.payload.total_earned_points,
        })
      : null
    const [previousAttempts, timezone] = await Promise.all([
      previousAttemptsPromise,
      timezonePromise,
    ])

    return (
      <V3ResultsView
        attemptId={attempt.id}
        promptText={attempt.prompt_text}
        additionalContext={additionalContext}
        transcript={attempt.transcript ?? ''}
        words={storedTranscriptWords(attempt.metrics)}
        durationMs={durationMs}
        audioUrl={audioUrl}
        audioUnavailable={audioUnavailable}
        payload={result.payload}
        comparison={comparison}
        previousAttempts={previousAttempts}
        timezone={timezone}
        curriculumResult={curriculumResult?.status === 'ready' ? curriculumResult.data : null}
      />
    )
  }

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
      {retryHref ? (
        <ButtonLink href={retryHref} size="lg" fullWidth>
          Try this prompt again
        </ButtonLink>
      ) : null}
    </div>,
    audioUnavailable,
  )
}
