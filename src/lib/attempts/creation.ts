import { extensionForMimeType } from '@/lib/recording/mime'
import type { CreateAttemptPayload } from '@/lib/recording/attempt-payload'
import {
  matchesRetrySession,
  retrySessionFromAttempt,
  type PracticeSessionDescriptor,
} from '@/lib/practice/session'
import type { LibraryPrompt } from '@/lib/prompts/selection'
import type { AttemptMetrics } from '@/lib/types/metrics'
import { isRetryableAttemptStatus } from '@/lib/attempts/lifecycle'

interface StoredCreationSnapshot {
  id: string
  prompt_id: string | null
  prompt_text: string
  duration_ms: number | null
  practice_mode: unknown
  prompt_source: unknown
  prompt_difficulty: unknown
  rubric_version: string | null
  retry_of_attempt_id: string | null
  client_request_id: string | null
  metrics: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function attemptStoragePath(userId: string, attemptId: string, mimeType: string): string {
  return `${userId}/${attemptId}.${extensionForMimeType(mimeType)}`
}

/** Returns DB-owned prompt metadata only when the submitted library snapshot is still current. */
export function libraryCreationSession(
  requested: CreateAttemptPayload,
  prompt: LibraryPrompt,
): PracticeSessionDescriptor | null {
  if (
    requested.source !== 'library' ||
    requested.retryOfAttemptId !== null ||
    requested.promptId !== prompt.id ||
    requested.promptText !== prompt.text ||
    requested.mode !== prompt.mode ||
    requested.difficulty !== prompt.difficulty ||
    requested.targetDurationSeconds !== prompt.targetDurationSeconds ||
    requested.additionalContext !== undefined
  ) {
    return null
  }

  return {
    promptId: prompt.id,
    promptText: prompt.text,
    mode: prompt.mode,
    difficulty: prompt.difficulty,
    source: 'library',
    targetDurationSeconds: prompt.targetDurationSeconds,
    retryOfAttemptId: null,
  }
}

/** Custom prompt text is private input, but its source invariants remain server validated. */
export function customCreationSession(
  requested: CreateAttemptPayload,
): PracticeSessionDescriptor | null {
  if (
    requested.source !== 'custom' ||
    requested.promptId !== null ||
    requested.retryOfAttemptId !== null ||
    requested.difficulty !== 'beginner'
  ) {
    return null
  }
  return {
    promptId: null,
    promptText: requested.promptText,
    mode: requested.mode,
    difficulty: 'beginner',
    source: 'custom',
    targetDurationSeconds: requested.targetDurationSeconds,
    retryOfAttemptId: null,
    ...(requested.additionalContext ? { additionalContext: requested.additionalContext } : {}),
  }
}

/** Retry metadata comes from a settled owned parent, never from browser claims. */
export function retryCreationSession(
  requested: CreateAttemptPayload,
  parent: unknown,
): PracticeSessionDescriptor | null {
  if (
    !isRecord(parent) ||
    !isRetryableAttemptStatus(parent.status) ||
    !matchesRetrySession(requested, parent)
  ) {
    return null
  }
  return retrySessionFromAttempt(parent)
}

export function initialAttemptMetrics(
  session: PracticeSessionDescriptor,
  mimeType: string,
  storagePath: string,
): AttemptMetrics {
  return {
    creation: {
      prompt_id: session.promptId,
      retry_of_attempt_id: session.retryOfAttemptId,
    },
    practice: {
      target_duration_seconds: session.targetDurationSeconds,
      ...(session.additionalContext ? { additional_context: session.additionalContext } : {}),
    },
    upload: { storage_path: storagePath, mime_type: mimeType },
  }
}

export type StoredAttemptReuse = { storagePath: string } | null

/** Resolves an idempotent replay only from the immutable stored creation snapshot. */
export function storedAttemptReuse(
  stored: StoredCreationSnapshot,
  requested: CreateAttemptPayload,
  userId: string,
  rubricVersion: string,
): StoredAttemptReuse {
  if (!isRecord(stored.metrics)) return null
  const practice = stored.metrics.practice
  const creation = stored.metrics.creation
  const upload = stored.metrics.upload
  if (!isRecord(practice) || !isRecord(creation) || !isRecord(upload)) return null
  if (typeof upload.storage_path !== 'string' || typeof upload.mime_type !== 'string') return null
  const storagePath = attemptStoragePath(userId, stored.id, requested.mimeType)

  const matches =
    stored.client_request_id === requested.clientRequestId &&
    stored.prompt_text === requested.promptText &&
    stored.duration_ms === requested.durationMs &&
    stored.practice_mode === requested.mode &&
    stored.prompt_source === requested.source &&
    stored.prompt_difficulty === requested.difficulty &&
    stored.rubric_version === rubricVersion &&
    creation.prompt_id === requested.promptId &&
    creation.retry_of_attempt_id === requested.retryOfAttemptId &&
    (stored.prompt_id === requested.promptId || stored.prompt_id === null) &&
    (stored.retry_of_attempt_id === requested.retryOfAttemptId ||
      stored.retry_of_attempt_id === null) &&
    practice.target_duration_seconds === requested.targetDurationSeconds &&
    (practice.additional_context ?? undefined) === requested.additionalContext &&
    upload.storage_path === storagePath &&
    upload.mime_type === requested.mimeType

  return matches ? { storagePath } : null
}
