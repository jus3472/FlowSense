import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { ATTEMPT_FAILURE_CODES, canFinalizeAttemptUpload } from '@/lib/attempts/lifecycle'
import {
  authenticatedAttemptContext,
  logAttemptDiagnostic,
  markOwnedAttemptFailure,
  transitionOwnedAttempt,
} from '@/lib/attempts/server'
import { parseCaptureMetrics } from '@/lib/recording/capture-payload'
import { RECORDINGS_BUCKET } from '@/lib/recording/storage'
import { isUuid } from '@/lib/practice/session'
import type { AttemptMetrics } from '@/lib/types/metrics'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function storedUpload(metrics: unknown): AttemptMetrics['upload'] | null {
  if (!isRecord(metrics) || !isRecord(metrics.upload)) return null
  const storagePath = metrics.upload.storage_path
  const mimeType = metrics.upload.mime_type
  return typeof storagePath === 'string' && typeof mimeType === 'string'
    ? { storage_path: storagePath, mime_type: mimeType }
    : null
}

async function recordingExists(
  admin: NonNullable<Awaited<ReturnType<typeof authenticatedAttemptContext>>>['admin'],
  userId: string,
  audioPath: string,
): Promise<{ exists: boolean; failed: boolean }> {
  const prefix = `${userId}/`
  if (!audioPath.startsWith(prefix)) return { exists: false, failed: false }
  const fileName = audioPath.slice(prefix.length)
  if (!fileName || fileName.includes('/')) return { exists: false, failed: false }

  const { data, error } = await admin.storage
    .from(RECORDINGS_BUCKET)
    .list(userId, { limit: 100, search: fileName })
  if (error) return { exists: false, failed: true }
  return { exists: (data ?? []).some((object) => object.name === fileName), failed: false }
}

/** Verifies the uploaded object and advances the owned attempt to transcription. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return apiError('That attempt does not exist.', 404)
  const context = await authenticatedAttemptContext()
  if (!context) return apiError('Your session ended. Log in and try again.', 401)
  const { userId, admin } = context

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('The request body was not valid JSON.', 400)
  }

  const payload = isRecord(body) ? body : {}
  const audioPath = typeof payload.audioPath === 'string' ? payload.audioPath : ''
  const capture = parseCaptureMetrics(payload.capture)
  if (!capture) return apiError('The capture timelines were missing or malformed.', 400)

  const { data: attempt, error: readError } = await admin
    .from('attempts')
    .select('id, audio_path, duration_ms, metrics, status')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) {
    logAttemptDiagnostic('load_upload_attempt', 'attempt_read_failed', id, readError)
    return apiError('The recording details could not be saved.', 500)
  }
  if (!attempt) return apiError('That attempt does not exist.', 404)

  const expected = storedUpload(attempt.metrics)
  if (
    !expected ||
    audioPath !== expected.storage_path ||
    capture.mime_type !== expected.mime_type ||
    !audioPath.startsWith(`${userId}/${attempt.id}.`)
  ) {
    return apiError('The recording details did not match this attempt.', 400)
  }

  const existingMetrics = (attempt.metrics as AttemptMetrics | null) ?? {}
  if (
    ['transcribing', 'scoring', 'done'].includes(attempt.status) &&
    attempt.audio_path === audioPath &&
    existingMetrics.capture
  ) {
    return NextResponse.json({ ok: true })
  }
  if (!canFinalizeAttemptUpload(attempt.status)) {
    return apiError('That attempt cannot accept recording details now.', 409)
  }

  const presence = await recordingExists(admin, userId, audioPath)
  if (presence.failed) {
    await markOwnedAttemptFailure(
      admin,
      userId,
      id,
      [attempt.status],
      attempt.status === 'timed_out' ? 'timed_out' : 'failed',
      ATTEMPT_FAILURE_CODES.uploadVerificationFailed,
    )
    return apiError('The recording could not be verified.', 502)
  }
  if (!presence.exists) {
    await markOwnedAttemptFailure(
      admin,
      userId,
      id,
      [attempt.status],
      attempt.status === 'timed_out' ? 'timed_out' : 'failed',
      ATTEMPT_FAILURE_CODES.uploadMissing,
    )
    return apiError('The recording was not found. Save it again and retry.', 400)
  }

  const metrics: AttemptMetrics = { ...existingMetrics, capture }
  const updated = await transitionOwnedAttempt(
    admin,
    userId,
    id,
    [attempt.status],
    'transcribing',
    {
      audio_path: audioPath,
      duration_ms: capture.duration_ms,
      metrics: JSON.parse(JSON.stringify(metrics)),
    },
  )
  if (!updated) return apiError('The recording details could not be saved.', 409)
  return NextResponse.json({ ok: true })
}

/** Deletes an owned row and its exact private recording object through the admin boundary. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return apiError('That attempt does not exist.', 404)
  const context = await authenticatedAttemptContext()
  if (!context) return apiError('Your session ended. Log in and try again.', 401)
  const { userId, admin } = context

  const { data: attempt, error: readError } = await admin
    .from('attempts')
    .select('id, audio_path')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) {
    logAttemptDiagnostic('load_delete_attempt', 'attempt_read_failed', id, readError)
    return apiError('The response could not be deleted.', 500)
  }
  if (!attempt) return apiError('That attempt does not exist.', 404)

  if (attempt.audio_path) {
    const { error } = await admin.storage.from(RECORDINGS_BUCKET).remove([attempt.audio_path])
    if (error) {
      logAttemptDiagnostic('delete_recording', 'recording_delete_failed', id, error)
      return apiError('The response could not be deleted.', 500)
    }
  }

  const { data, error } = await admin
    .from('attempts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    logAttemptDiagnostic('delete_attempt', 'attempt_delete_failed', id, error)
    return apiError('The response could not be deleted.', error ? 500 : 409)
  }

  return NextResponse.json({ ok: true })
}
