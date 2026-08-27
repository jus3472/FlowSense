import { extensionForMimeType } from '@/lib/recording/mime'
import type { CreateAttemptPayload } from '@/lib/recording/attempt-payload'
import {
  matchesRetrySession,
  retrySessionFromAttempt,
  type PracticeSessionDescriptor,
} from '@/lib/practice/session'
import type { LibraryPrompt } from '@/lib/prompts/selection'
import type { AttemptMetrics } from '@/lib/types/metrics'

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

/** Retry metadata comes from the completed owned parent, never from browser claims. */
export function retryCreationSession(
  requested: CreateAttemptPayload,
  parent: unknown,
): PracticeSessionDescriptor | null {
  if (!isRecord(parent) || parent.status !== 'done' || !matchesRetrySession(requested, parent)) {
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
    practice: {
      target_duration_seconds: session.targetDurationSeconds,
      ...(session.additionalContext ? { additional_context: session.additionalContext } : {}),
    },
    upload: { storage_path: storagePath, mime_type: mimeType },
  }
}

/** Prevents one idempotency key from being reused for a different logical recording. */
export function matchesStoredAttemptCreation(
  stored: StoredCreationSnapshot,
  requested: CreateAttemptPayload,
  session: PracticeSessionDescriptor,
  storagePath: string,
  rubricVersion: string,
): boolean {
  if (!isRecord(stored.metrics)) return false
  const practice = stored.metrics.practice
  const upload = stored.metrics.upload
  if (!isRecord(practice) || !isRecord(upload)) return false

  return (
    stored.client_request_id === requested.clientRequestId &&
    stored.prompt_id === session.promptId &&
    stored.prompt_text === session.promptText &&
    stored.duration_ms === requested.durationMs &&
    stored.practice_mode === session.mode &&
    stored.prompt_source === session.source &&
    stored.prompt_difficulty === session.difficulty &&
    stored.rubric_version === rubricVersion &&
    stored.retry_of_attempt_id === session.retryOfAttemptId &&
    practice.target_duration_seconds === session.targetDurationSeconds &&
    (practice.additional_context ?? undefined) === session.additionalContext &&
    upload.storage_path === storagePath &&
    upload.mime_type === requested.mimeType
  )
}
