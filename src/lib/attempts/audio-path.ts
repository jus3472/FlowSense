import { attemptStoragePath } from '@/lib/attempts/creation'
import { isRecordingMimeType } from '@/lib/recording/mime'

export interface OwnedAttemptAudioPath {
  storagePath: string
  mimeType: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrows a stored path before any service-role storage access. Every current
 * attempt receives this immutable upload snapshot during server-side creation.
 */
export function validateOwnedAttemptAudioPath(input: {
  userId: string
  attemptId: string
  audioPath: unknown
  metrics: unknown
}): OwnedAttemptAudioPath | null {
  const { userId, attemptId, audioPath, metrics } = input
  if (typeof audioPath !== 'string' || !isRecord(metrics)) return null

  if (!isRecord(metrics.upload)) return null
  if (
    typeof metrics.upload.storage_path !== 'string' ||
    typeof metrics.upload.mime_type !== 'string' ||
    !isRecordingMimeType(metrics.upload.mime_type) ||
    metrics.upload.storage_path !== audioPath
  ) {
    return null
  }
  const mimeType = metrics.upload.mime_type

  return audioPath === attemptStoragePath(userId, attemptId, mimeType)
    ? { storagePath: audioPath, mimeType }
    : null
}

/** Resolves the immutable upload path even when audio_path was never finalized. */
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
  return owned
}
