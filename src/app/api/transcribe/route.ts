import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { validateOwnedAttemptAudioPath } from '@/lib/attempts/audio-path'
import {
  ATTEMPT_FAILURE_CODES,
  canRunTranscription,
  terminalStatusForTimeout,
} from '@/lib/attempts/lifecycle'
import {
  authenticatedAttemptContext,
  logAttemptDiagnostic,
  markOwnedAttemptFailure,
  transitionOwnedAttempt,
} from '@/lib/attempts/server'
import {
  DeepgramParseError,
  deepgramQualityMetrics,
  parseDeepgramResponse,
} from '@/lib/deepgram/parse'
import {
  DEEPGRAM_MODEL,
  buildDeepgramUrl,
  deepgramAuthHeader,
  isFillerToken,
} from '@/lib/deepgram/request'
import { deepgramApiKey } from '@/lib/env/server'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { isUuid } from '@/lib/practice/session'
import type { AttemptMetrics } from '@/lib/types/metrics'

/** Deepgram on 60 seconds of audio finishes in a few seconds. This is headroom. */
export const maxDuration = 60

/** Leaves room to answer before the browser's own 30 second abort fires. */
const DEEPGRAM_TIMEOUT_MS = 25_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function POST(request: Request) {
  const context = await authenticatedAttemptContext()
  if (!context) return apiError('Your session ended. Log in and try again.', 401)
  const { userId, admin } = context

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('The request body was not valid JSON.', 400)
  }

  const attemptId = isRecord(body) && typeof body.attemptId === 'string' ? body.attemptId : ''
  if (!isUuid(attemptId)) return apiError('The attempt id was invalid.', 400)

  const { data: attempt, error: readError } = await admin
    .from('attempts')
    .select('id, audio_path, metrics, transcript, status')
    .eq('id', attemptId)
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) {
    logAttemptDiagnostic('load_transcription_attempt', 'attempt_read_failed', attemptId, readError)
    return apiError('The transcript could not be made.', 500)
  }
  if (!attempt) return apiError('That attempt does not exist.', 404)

  const metrics = (attempt.metrics as AttemptMetrics | null) ?? {}
  const storedWords = metrics.transcript?.words
  if (
    (attempt.status === 'scoring' || attempt.status === 'done') &&
    attempt.transcript !== null &&
    storedWords
  ) {
    return NextResponse.json({ transcript: attempt.transcript, wordCount: storedWords.length })
  }
  if (!canRunTranscription(attempt.status)) {
    return apiError('That attempt is not ready to be transcribed.', 409)
  }
  if (attempt.status === 'failed' || attempt.status === 'timed_out') {
    const resumed = await transitionOwnedAttempt(
      admin,
      userId,
      attemptId,
      [attempt.status],
      'transcribing',
    )
    if (!resumed) return apiError('That attempt could not resume transcription.', 409)
  }

  const ownedAudio = validateOwnedAttemptAudioPath({
    userId,
    attemptId,
    audioPath: attempt.audio_path,
    metrics,
  })
  if (!ownedAudio) {
    logAttemptDiagnostic(
      'validate_recording_path',
      ATTEMPT_FAILURE_CODES.recordingPathInvalid,
      attemptId,
    )
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['transcribing'],
      'failed',
      ATTEMPT_FAILURE_CODES.recordingPathInvalid,
    )
    return apiError('The saved recording path could not be verified.', 409)
  }

  const { data: audio, error: downloadError } = await admin.storage
    .from(RECORDINGS_BUCKET)
    .download(ownedAudio.storagePath)
  if (downloadError || !audio) {
    logAttemptDiagnostic(
      'download_recording',
      ATTEMPT_FAILURE_CODES.recordingUnavailable,
      attemptId,
      downloadError,
    )
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['transcribing'],
      'failed',
      ATTEMPT_FAILURE_CODES.recordingUnavailable,
    )
    return apiError('The saved recording could not be read.', 502)
  }

  const contentType = ownedAudio.mimeType
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEEPGRAM_TIMEOUT_MS)
  const url = buildDeepgramUrl()
  console.info('[transcribe] request', {
    attemptId,
    operation: 'deepgram_transcription',
    model: DEEPGRAM_MODEL,
    contentType,
    audioBytes: audio.size,
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: deepgramAuthHeader(deepgramApiKey()),
        'Content-Type': contentType,
      },
      body: await audio.arrayBuffer(),
      signal: controller.signal,
    })
  } catch (error) {
    const timedOut = controller.signal.aborted
    const failureCode = timedOut
      ? ATTEMPT_FAILURE_CODES.transcriptionTimeout
      : ATTEMPT_FAILURE_CODES.transcriptionUnavailable
    logAttemptDiagnostic('call_transcription_provider', failureCode, attemptId, error)
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['transcribing'],
      terminalStatusForTimeout(timedOut),
      failureCode,
    )
    return apiError(
      timedOut ? 'The transcription timed out. Try again.' : 'The transcript could not be made.',
      timedOut ? 504 : 502,
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    logAttemptDiagnostic(
      'transcription_provider_response',
      ATTEMPT_FAILURE_CODES.transcriptionRejected,
      attemptId,
    )
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['transcribing'],
      'failed',
      ATTEMPT_FAILURE_CODES.transcriptionRejected,
    )
    return apiError('The transcript could not be made.', 502)
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch (error) {
    logAttemptDiagnostic(
      'parse_transcription_json',
      ATTEMPT_FAILURE_CODES.transcriptionInvalidResponse,
      attemptId,
      error,
    )
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['transcribing'],
      'failed',
      ATTEMPT_FAILURE_CODES.transcriptionInvalidResponse,
    )
    return apiError('The transcript could not be made.', 502)
  }

  let parsed
  try {
    parsed = parseDeepgramResponse(raw)
  } catch (error) {
    const unavailableQuality =
      error instanceof DeepgramParseError
        ? error.quality
        : { status: 'unavailable' as const, diagnostics: ['Transcript parsing failed.'] }
    const failedMetrics: AttemptMetrics = {
      ...metrics,
      transcript: {
        provider: 'deepgram',
        model: DEEPGRAM_MODEL,
        confidence: null,
        words: [],
        quality: unavailableQuality,
      },
    }
    logAttemptDiagnostic(
      'validate_transcription_response',
      ATTEMPT_FAILURE_CODES.transcriptionInvalidResponse,
      attemptId,
      error,
    )
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['transcribing'],
      'failed',
      ATTEMPT_FAILURE_CODES.transcriptionInvalidResponse,
      { metrics: JSON.parse(JSON.stringify(failedMetrics)) },
    )
    return apiError('The transcript could not be made.', 502)
  }

  const fillerCount = parsed.words.filter((entry) => isFillerToken(entry.word)).length
  console.info('[transcribe] response', {
    attemptId,
    operation: 'deepgram_transcription',
    status: response.status,
    model: DEEPGRAM_MODEL,
    words: parsed.words.length,
    fillers: fillerCount,
    quality: parsed.quality.status,
  })

  const nextMetrics: AttemptMetrics = {
    ...metrics,
    transcript: {
      provider: 'deepgram',
      model: DEEPGRAM_MODEL,
      confidence: parsed.confidence,
      words: parsed.words,
      duration_seconds: parsed.durationSeconds,
      ...deepgramQualityMetrics(parsed),
    },
  }

  const saved = await transitionOwnedAttempt(
    admin,
    userId,
    attemptId,
    ['transcribing'],
    'scoring',
    {
      transcript: parsed.transcript,
      metrics: JSON.parse(JSON.stringify(nextMetrics)),
    },
  )
  if (!saved) {
    await markOwnedAttemptFailure(
      admin,
      userId,
      attemptId,
      ['transcribing'],
      'failed',
      ATTEMPT_FAILURE_CODES.transcriptionPersistenceFailed,
    )
    return apiError('The transcript could not be saved.', 500)
  }

  return NextResponse.json({ transcript: parsed.transcript, wordCount: parsed.words.length })
}
