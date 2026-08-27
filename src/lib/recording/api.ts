import { publicEnv } from '@/lib/env/public'
import { fetchWithTimeout } from '@/lib/net/fetch-with-timeout'
import { promiseWithTimeout } from '@/lib/net/promise-with-timeout'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { createClient } from '@/lib/supabase/client'
import type { CaptureMetrics } from '@/lib/types/metrics'
import type { PracticeSessionDescriptor } from '@/lib/practice/session'
import type { ClientFailureOutcome, ClientFailureStage } from '@/lib/attempts/client-failure'
import {
  AUTH_SESSION_TIMEOUT_MS,
  CLIENT_FAILURE_REPORT_TIMEOUT_MS,
  SCORING_REQUEST_TIMEOUT_MS,
  TRANSCRIPTION_REQUEST_TIMEOUT_MS,
} from '@/lib/recording/timeouts'

/**
 * Browser side calls for the recording pipeline. Each one is a single network
 * boundary with its own timeout, so a stall in any of them lands the state
 * machine on `timed_out` rather than nowhere.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Prefers the server's own sentence. Falls back to one, never a bare code. */
async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (isRecord(body)) {
      for (const key of ['error', 'message', 'msg']) {
        const value = body[key]
        if (typeof value === 'string' && value.trim().length > 0) return value
      }
    }
  } catch {
    // No JSON body. The fallback sentence carries the status instead.
  }
  return `${fallback} The server answered ${response.status}.`
}

async function accessToken(signal?: AbortSignal): Promise<string> {
  const {
    data: { session },
  } = await promiseWithTimeout(createClient().auth.getSession(), {
    label: 'Checking your session',
    timeoutMs: AUTH_SESSION_TIMEOUT_MS,
    signal,
  })
  if (!session) throw new Error('Your session ended. Log in and try again.')
  return session.access_token
}

export interface CreateAttemptInput extends PracticeSessionDescriptor {
  clientRequestId: string
  durationMs: number
  mimeType: string
}

export interface CreatedAttempt {
  attemptId: string
  storagePath: string
}

const requestIdsBySession = new WeakMap<PracticeSessionDescriptor, string>()

function requestIdForSession(session: PracticeSessionDescriptor): string {
  const existing = requestIdsBySession.get(session)
  if (existing) return existing
  const created = crypto.randomUUID()
  requestIdsBySession.set(session, created)
  return created
}

export async function createAttempt(
  input: CreateAttemptInput,
  signal?: AbortSignal,
): Promise<CreatedAttempt> {
  const response = await fetchWithTimeout(
    '/api/attempts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    },
    { label: 'Creating the attempt' },
  )

  if (!response.ok) throw new Error(await readError(response, 'The attempt could not be created.'))

  const body: unknown = await response.json()
  if (
    !isRecord(body) ||
    typeof body.attemptId !== 'string' ||
    typeof body.storagePath !== 'string'
  ) {
    throw new Error('The server did not return an attempt to save into.')
  }
  return { attemptId: body.attemptId, storagePath: body.storagePath }
}

export function createAttemptForSession(
  session: PracticeSessionDescriptor,
  input: Pick<CreateAttemptInput, 'durationMs' | 'mimeType'>,
  clientRequestId = requestIdForSession(session),
): CreateAttemptInput {
  return { ...session, ...input, clientRequestId }
}

/** Straight from the browser to the private bucket, under the user's own prefix. */
export async function uploadAudio(
  blob: Blob,
  storagePath: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<void> {
  const token = await accessToken(signal)
  const url = `${publicEnv.supabaseUrl}/storage/v1/object/${RECORDINGS_BUCKET}/${storagePath}`

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: publicEnv.supabasePublishableKey,
        'Content-Type': mimeType,
        // A retry re-sends the same path, which would otherwise collide.
        'x-upsert': 'true',
      },
      body: blob,
      signal,
    },
    { label: 'Saving your recording' },
  )

  if (!response.ok) throw new Error(await readError(response, 'The recording could not be saved.'))
}

export async function saveRecording(
  attemptId: string,
  audioPath: string,
  capture: CaptureMetrics,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchWithTimeout(
    `/api/attempts/${attemptId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioPath, capture }),
      signal,
    },
    { label: 'Saving your recording' },
  )

  if (!response.ok) {
    throw new Error(await readError(response, 'The recording details could not be saved.'))
  }
}

export async function transcribeAttempt(
  attemptId: string,
  signal?: AbortSignal,
): Promise<{ wordCount: number }> {
  const response = await fetchWithTimeout(
    '/api/transcribe',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId }),
      signal,
    },
    { label: 'Transcribing your answer', timeoutMs: TRANSCRIPTION_REQUEST_TIMEOUT_MS },
  )

  if (!response.ok) throw new Error(await readError(response, 'The transcript could not be made.'))

  const body: unknown = await response.json()
  return { wordCount: isRecord(body) && typeof body.wordCount === 'number' ? body.wordCount : 0 }
}

export async function scoreAttempt(
  attemptId: string,
  signal?: AbortSignal,
): Promise<{ score: number | null }> {
  const response = await fetchWithTimeout(
    '/api/score',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId }),
      signal,
    },
    { label: 'Scoring your answer', timeoutMs: SCORING_REQUEST_TIMEOUT_MS },
  )

  if (!response.ok) throw new Error(await readError(response, 'The score could not be computed.'))

  const body: unknown = await response.json()
  return { score: isRecord(body) && typeof body.score === 'number' ? body.score : null }
}

/** Reports only a bounded stage/outcome; the server owns its status and code mapping. */
export async function persistAttemptFailure(
  attemptId: string,
  expectedStage: ClientFailureStage,
  outcome: ClientFailureOutcome,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchWithTimeout(
    `/api/attempts/${attemptId}/failure`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedStage, outcome }),
      signal,
    },
    { label: 'Saving the processing state', timeoutMs: CLIENT_FAILURE_REPORT_TIMEOUT_MS },
  )

  if (!response.ok) {
    throw new Error(await readError(response, 'The processing state could not be saved.'))
  }
}

/**
 * Page teardown cannot await a response. The full idempotent creation input
 * lets the server reconcile even when the create response was lost.
 */
export function abandonUploadingAttempt(input: CreateAttemptInput, attemptId?: string): void {
  void fetch('/api/attempts/abandon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, ...(attemptId ? { attemptId } : {}) }),
    keepalive: true,
  })
    .then((response) => response.body?.cancel())
    .catch(() => undefined)
}
