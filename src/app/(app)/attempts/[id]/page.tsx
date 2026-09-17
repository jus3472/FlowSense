import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import { AudioPlayer } from '@/components/record/audio-player'
import { DeleteResponseControl } from '@/components/results/delete-response-control'
import { V3ResultsView } from '@/components/results/v3-results-view'
import { ResultPrompt } from '@/components/results/result-prompt'
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
import { attemptRetryHref, attemptTrackHref } from '@/lib/attempts/retry-href'
import { logAttemptDiagnostic } from '@/lib/attempts/server'
import { loadStructuredLessonResultForUser } from '@/lib/curriculum/result-server'
import { isUuid } from '@/lib/practice/session'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { readAttemptResult, storedTranscriptWords } from '@/lib/results/attempt-result'
import { loadLessonAttemptHistoryForUser } from '@/lib/results/lesson-attempt-history'
import { createClient } from '@/lib/supabase/server'
import { safeTimezone, UTC_TIMEZONE } from '@/lib/timezone'

export const metadata: Metadata = {
  title: 'Your answer',
}

const SIGNED_URL_SECONDS = 60 * 60
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

function resultWithAudioStatus(content: ReactNode, audioUnavailable: boolean, attemptId: string) {
  return (
    <div className="max-w-column mx-auto flex w-full flex-col gap-4">
      {audioUnavailable ? (
        <p role="status" className="text-muted text-sm">
          Audio playback is unavailable for this response.
        </p>
      ) : null}
      {content}
      <div className="border-border flex border-t pt-4">
        <DeleteResponseControl attemptId={attemptId} />
      </div>
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
      <ResultPrompt>{promptText}</ResultPrompt>
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

function abandonedUploadResult(
  promptText: string,
  retryHref: ReturnType<typeof attemptRetryHref>,
  trackHref: ReturnType<typeof attemptTrackHref>,
) {
  return (
    <div className="flex flex-col gap-8">
      <ResultPrompt>{promptText}</ResultPrompt>
      <Card>
        <EmptyState
          title="Recording not saved"
          description="This recording did not finish saving. Try the same prompt again or delete this response."
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
        {trackHref ? (
          <ButtonLink href={trackHref} variant="ghost" fullWidth>
            Back to Track
          </ButtonLink>
        ) : null}
      </div>
    </div>
  )
}

function incompleteResultCopy(failureCode: string | null): {
  title: string
  description: string
} {
  if (
    failureCode === ATTEMPT_FAILURE_CODES.recordingUnavailable ||
    failureCode === ATTEMPT_FAILURE_CODES.recordingPathInvalid
  ) {
    return {
      title: 'Recording unavailable',
      description:
        "We saved your response but couldn't read the recording, so it could not be evaluated. Try the prompt again.",
    }
  }
  if (
    failureCode === ATTEMPT_FAILURE_CODES.uploadMissing ||
    failureCode === ATTEMPT_FAILURE_CODES.uploadVerificationFailed
  ) {
    return {
      title: 'Recording not saved',
      description:
        "We couldn't finish saving this recording, so this response could not be evaluated. Try the prompt again.",
    }
  }
  if (
    failureCode === ATTEMPT_FAILURE_CODES.transcriptionTimeout ||
    failureCode === ATTEMPT_FAILURE_CODES.transcriptionUnavailable ||
    failureCode === ATTEMPT_FAILURE_CODES.transcriptionRejected ||
    failureCode === ATTEMPT_FAILURE_CODES.transcriptionInvalidResponse ||
    failureCode === ATTEMPT_FAILURE_CODES.transcriptionPersistenceFailed ||
    failureCode === ATTEMPT_FAILURE_CODES.clientTranscriptionFailed ||
    failureCode === ATTEMPT_FAILURE_CODES.clientTranscriptionTimeout
  ) {
    return {
      title: 'Transcript unavailable',
      description:
        "We couldn't produce a usable transcript, so this response could not be evaluated. Try again in a moment.",
    }
  }
  if (
    failureCode === ATTEMPT_FAILURE_CODES.scoringInputInvalid ||
    failureCode === ATTEMPT_FAILURE_CODES.scoringUnexpected ||
    failureCode === ATTEMPT_FAILURE_CODES.scoringPersistenceFailed ||
    failureCode === ATTEMPT_FAILURE_CODES.unsupportedRubricVersion ||
    failureCode === ATTEMPT_FAILURE_CODES.clientScoringFailed ||
    failureCode === ATTEMPT_FAILURE_CODES.clientScoringTimeout
  ) {
    return {
      title: 'Result unavailable',
      description:
        "We saved your response but couldn't complete every check. Try again in a moment.",
    }
  }
  return {
    title: 'Result unavailable',
    description: 'This response was saved but could not be evaluated. Try the same prompt again.',
  }
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
  const trackHref = attemptTrackHref({
    attemptId: attempt.id,
    lessonId: attempt.lesson_id,
    metrics: attempt.metrics,
  })
  if (attempt.failure_code === ATTEMPT_FAILURE_CODES.clientUploadAbandoned) {
    return resultWithAudioStatus(
      abandonedUploadResult(attempt.prompt_text, retryHref, trackHref),
      false,
      attempt.id,
    )
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
    const unavailable = incompleteResultCopy(attempt.failure_code)
    return resultWithAudioStatus(
      <div className="flex flex-col gap-8">
        <ResultPrompt>{attempt.prompt_text}</ResultPrompt>
        {audioUrl ? <AudioPlayer src={audioUrl} durationMs={durationMs} /> : null}
        <Card>
          <EmptyState title={unavailable.title} description={unavailable.description} />
        </Card>
        <div className="flex flex-col gap-2">
          {retryHref ? (
            <ButtonLink href={retryHref} size="lg" fullWidth>
              Try this prompt again
            </ButtonLink>
          ) : null}
          {trackHref ? (
            <ButtonLink href={trackHref} variant="secondary" fullWidth>
              Back to Track
            </ButtonLink>
          ) : null}
        </div>
      </div>,
      audioUnavailable,
      attempt.id,
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
        promptText={attempt.prompt_text}
        additionalContext={additionalContext}
        transcript={attempt.transcript ?? ''}
        words={storedTranscriptWords(attempt.metrics)}
        durationMs={durationMs}
        audioUrl={audioUrl}
        audioUnavailable={audioUnavailable}
        payload={result.payload}
        previousAttempts={previousAttempts}
        timezone={timezone}
        curriculumResult={curriculumResult?.status === 'ready' ? curriculumResult.data : null}
        retryHref={retryHref}
        deleteControl={<DeleteResponseControl attemptId={attempt.id} fullWidth />}
      />
    )
  }

  return resultWithAudioStatus(
    <div className="flex flex-col gap-8">
      <ResultPrompt>{attempt.prompt_text}</ResultPrompt>
      {audioUrl ? <AudioPlayer src={audioUrl} durationMs={durationMs} /> : null}
      <Card>
        <EmptyState
          title="Result unavailable"
          description="This response uses a result format that is not available here yet."
        />
      </Card>
      <div className="flex flex-col gap-2">
        {retryHref ? (
          <ButtonLink href={retryHref} size="lg" fullWidth>
            Try this prompt again
          </ButtonLink>
        ) : null}
        {trackHref ? (
          <ButtonLink href={trackHref} variant="secondary" fullWidth>
            Back to Track
          </ButtonLink>
        ) : null}
      </div>
    </div>,
    audioUnavailable,
    attempt.id,
  )
}
