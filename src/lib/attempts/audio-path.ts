import { attemptStoragePath } from '@/lib/attempts/creation'
import { isRecordingMimeType } from '@/lib/recording/mime'

export interface OwnedAttemptAudioPath {
  storagePath: string
  mimeType: string
  snapshot: 'upload' | 'capture'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrows a stored path before any service-role storage access. New attempts
 * use the immutable upload snapshot; legacy rows must at least have a valid
 * capture MIME from which the exact owned path can be reconstructed.
 */
export function validateOwnedAttemptAudioPath(input: {
  userId: string
  attemptId: string
  audioPath: unknown
  metrics: unknown
}): OwnedAttemptAudioPath | null {
  const { userId, attemptId, audioPath, metrics } = input
  if (typeof audioPath !== 'string' || !isRecord(metrics)) return null

  let mimeType: string
  let snapshot: OwnedAttemptAudioPath['snapshot']
  if (metrics.upload !== undefined) {
    if (!isRecord(metrics.upload)) return null
    if (
      typeof metrics.upload.storage_path !== 'string' ||
      typeof metrics.upload.mime_type !== 'string' ||
      !isRecordingMimeType(metrics.upload.mime_type) ||
      metrics.upload.storage_path !== audioPath
    ) {
      return null
    }
    mimeType = metrics.upload.mime_type
    snapshot = 'upload'
  } else {
    if (
      !isRecord(metrics.capture) ||
      typeof metrics.capture.mime_type !== 'string' ||
      !isRecordingMimeType(metrics.capture.mime_type)
    ) {
      return null
    }
    mimeType = metrics.capture.mime_type
    snapshot = 'capture'
  }

  return audioPath === attemptStoragePath(userId, attemptId, mimeType)
    ? { storagePath: audioPath, mimeType, snapshot }
    : null
}

/** New upload cleanup never falls back to mutable legacy capture metadata. */
export function validateOwnedAttemptUploadPath(input: {
  userId: string
  attemptId: string
  metrics: unknown
}): OwnedAttemptAudioPath | null {
  const { metrics } = input
  if (!isRecord(metrics) || !isRecord(metrics.upload)) return null
  const owned = validateOwnedAttemptAudioPath({
    ...input,
    audioPath: metrics.upload.storage_path,
  })
  return owned?.snapshot === 'upload' ? owned : null
}
