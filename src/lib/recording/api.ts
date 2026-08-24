import { publicEnv } from '@/lib/env/public'
import { fetchWithTimeout } from '@/lib/net/fetch-with-timeout'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { createClient } from '@/lib/supabase/client'
import type { CaptureMetrics } from '@/lib/types/metrics'

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

async function accessToken(): Promise<string> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  if (!session) throw new Error('Your session ended. Log in and try again.')
  return session.access_token
}

export interface CreateAttemptInput {
  promptId: string | null
  promptText: string
  durationMs: number
  mimeType: string
}

export interface CreatedAttempt {
  attemptId: string
  storagePath: string
}

export async function createAttempt(input: CreateAttemptInput): Promise<CreatedAttempt> {
  const response = await fetchWithTimeout(
    '/api/attempts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
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

/** Straight from the browser to the private bucket, under the user's own prefix. */
export async function uploadAudio(
  blob: Blob,
  storagePath: string,
  mimeType: string,
): Promise<void> {
  const token = await accessToken()
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
    },
    { label: 'Saving your recording' },
  )

  if (!response.ok) throw new Error(await readError(response, 'The recording could not be saved.'))
}

export async function saveRecording(
  attemptId: string,
  audioPath: string,
  capture: CaptureMetrics,
): Promise<void> {
  const response = await fetchWithTimeout(
    `/api/attempts/${attemptId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioPath, capture }),
    },
    { label: 'Saving your recording' },
  )

  if (!response.ok) {
    throw new Error(await readError(response, 'The recording details could not be saved.'))
  }
}

export async function transcribeAttempt(attemptId: string): Promise<{ wordCount: number }> {
  const response = await fetchWithTimeout(
    '/api/transcribe',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId }),
    },
    { label: 'Transcribing your answer' },
  )

  if (!response.ok) throw new Error(await readError(response, 'The transcript could not be made.'))

  const body: unknown = await response.json()
  return { wordCount: isRecord(body) && typeof body.wordCount === 'number' ? body.wordCount : 0 }
}

export async function scoreAttempt(attemptId: string): Promise<{ score: number | null }> {
  const response = await fetchWithTimeout(
    '/api/score',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId }),
    },
    { label: 'Scoring your answer' },
  )

  if (!response.ok) throw new Error(await readError(response, 'The score could not be computed.'))

  const body: unknown = await response.json()
  return { score: isRecord(body) && typeof body.score === 'number' ? body.score : null }
}
