import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { apiError } from '@/lib/api/responses'
import {
  validateOwnedAttemptAudioPath,
  validateOwnedAttemptUploadPath,
} from '@/lib/attempts/audio-path'
import {
  ATTEMPT_FAILURE_CODES,
  canFinalizeAttemptUpload,
  isActiveAttemptStatus,
  type AttemptStatus,
} from '@/lib/attempts/lifecycle'
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

type DeletionClaim =
  | { status: 'ready'; attemptStatus: 'done' }
  | {
      status: 'ready'
      attemptStatus: Extract<AttemptStatus, 'failed' | 'timed_out'>
    }
  | { status: 'stale' }
  | { status: 'failure' }

async function claimAttemptDeletion(
  admin: NonNullable<Awaited<ReturnType<typeof authenticatedAttemptContext>>>['admin'],
  userId: string,
  attemptId: string,
  attemptStatus: Extract<AttemptStatus, 'done' | 'failed' | 'timed_out'>,
  failureCode: string | null,
): Promise<DeletionClaim> {
  if (attemptStatus === 'done') {
    return { status: 'ready', attemptStatus }
  }
  if (failureCode === ATTEMPT_FAILURE_CODES.deletionInProgress) {
    return { status: 'ready', attemptStatus }
  }

  const base = admin
    .from('attempts')
    .update({ failure_code: ATTEMPT_FAILURE_CODES.deletionInProgress })
    .eq('id', attemptId)
    .eq('user_id', userId)
    .eq('status', attemptStatus)
  const matched =
    failureCode === null ? base.is('failure_code', null) : base.eq('failure_code', failureCode)
  const { data, error } = await matched.select('id').maybeSingle()
  if (error) {
    logAttemptDiagnostic('claim_attempt_deletion', 'attempt_delete_claim_failed', attemptId, error)
    return { status: 'failure' }
  }
  return data ? { status: 'ready', attemptStatus } : { status: 'stale' }
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
    .select('id, audio_path, duration_ms, metrics, status, failure_code')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) {
    logAttemptDiagnostic('load_upload_attempt', 'attempt_read_failed', id, readError)
    return apiError('The recording details could not be saved.', 500)
  }
  if (!attempt) return apiError('That attempt does not exist.', 404)
  if (attempt.failure_code === ATTEMPT_FAILURE_CODES.clientUploadAbandoned) {
    return apiError('That recording request was already closed.', 409)
  }

  const ownedAudio = validateOwnedAttemptAudioPath({
    userId,
    attemptId: attempt.id,
    audioPath,
    metrics: attempt.metrics,
  })
  if (!ownedAudio || capture.mime_type !== ownedAudio.mimeType) {
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

  const presence = await recordingExists(admin, userId, ownedAudio.storagePath)
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
      audio_path: ownedAudio.storagePath,
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
    .select('id, audio_path, metrics, status, failure_code')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) {
    logAttemptDiagnostic('load_delete_attempt', 'attempt_read_failed', id, readError)
    return apiError('The response could not be deleted.', 500)
  }
  if (!attempt) return apiError('That attempt does not exist.', 404)
  if (isActiveAttemptStatus(attempt.status)) {
    return apiError('That response is still processing and cannot be deleted yet.', 409)
  }

  const ownedAudio = attempt.audio_path
    ? validateOwnedAttemptAudioPath({
        userId,
        attemptId: attempt.id,
        audioPath: attempt.audio_path,
        metrics: attempt.metrics,
      })
    : validateOwnedAttemptUploadPath({
        userId,
        attemptId: attempt.id,
        metrics: attempt.metrics,
      })
  if (attempt.audio_path && !ownedAudio) {
    logAttemptDiagnostic('delete_recording', ATTEMPT_FAILURE_CODES.recordingPathInvalid, id)
    return apiError('The saved recording path could not be verified.', 409)
  }

  const claim = await claimAttemptDeletion(admin, userId, id, attempt.status, attempt.failure_code)
  if (claim.status === 'failure') return apiError('The response could not be deleted.', 500)
  if (claim.status === 'stale') {
    return apiError('That response changed before it could be deleted.', 409)
  }

  if (ownedAudio) {
    const { error } = await admin.storage.from(RECORDINGS_BUCKET).remove([ownedAudio.storagePath])
    if (error) {
      // Bulk deletion is intended to be idempotent. If Storage reports an
      // error after another delete already removed this exact object, finishing
      // the claimed row deletion is still safe.
      const presence = await recordingExists(admin, userId, ownedAudio.storagePath)
      if (presence.failed || presence.exists) {
        logAttemptDiagnostic('delete_recording', 'recording_delete_failed', id, error)
        return apiError('The response could not be deleted.', 500)
      }
    }
  }

  let deleteQuery = admin
    .from('attempts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', claim.attemptStatus)
  if (claim.attemptStatus !== 'done') {
    deleteQuery = deleteQuery.eq('failure_code', ATTEMPT_FAILURE_CODES.deletionInProgress)
  }
  const { data, error } = await deleteQuery.select('id').maybeSingle()
  if (error || !data) {
    logAttemptDiagnostic('delete_attempt', 'attempt_delete_failed', id, error)
    return apiError('The response could not be deleted.', error ? 500 : 409)
  }

  revalidatePath('/home')
  revalidatePath('/history')
  revalidatePath('/progress')
  return NextResponse.json({ ok: true })
}
