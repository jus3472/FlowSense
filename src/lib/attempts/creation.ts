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
import type { CurriculumLessonSession } from '@/lib/curriculum/data'
import {
  matchesStructuredPracticeSession,
  matchesStructuredRetryParent,
  structuredPracticeSession,
} from '@/lib/curriculum/recording'

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
  lesson_id?: string | null
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
    requested.additionalContext !== undefined ||
    requested.curriculum !== undefined
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
    requested.difficulty !== 'beginner' ||
    requested.curriculum !== undefined
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

/** Curriculum metadata and prompt fields are accepted only after DB revalidation. */
export function structuredCreationSession(
  requested: CreateAttemptPayload,
  lesson: CurriculumLessonSession,
  parent: unknown = null,
): PracticeSessionDescriptor | null {
  if (!requested.curriculum || !matchesStructuredPracticeSession(requested, lesson)) return null
  if (requested.retryOfAttemptId === null) {
    if (parent !== null) return null
  } else if (!matchesStructuredRetryParent(parent, lesson, requested.retryOfAttemptId)) {
    return null
  }
  return structuredPracticeSession(lesson, requested.retryOfAttemptId)
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
      ...(session.curriculum
        ? {
            curriculum: {
              lesson_id: session.curriculum.lessonId,
              path_slug: session.curriculum.pathSlug,
              chapter_level: session.curriculum.chapterLevel,
              lesson_slug: session.curriculum.lessonSlug,
              lesson_position: session.curriculum.lessonPosition,
              checkpoint: session.curriculum.checkpoint,
            },
          }
        : {}),
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
  const requestedCurriculum = requested.curriculum
    ? {
        lesson_id: requested.curriculum.lessonId,
        path_slug: requested.curriculum.pathSlug,
        chapter_level: requested.curriculum.chapterLevel,
        lesson_slug: requested.curriculum.lessonSlug,
        lesson_position: requested.curriculum.lessonPosition,
        checkpoint: requested.curriculum.checkpoint,
      }
    : undefined
  const storedCurriculum = creation.curriculum
  const curriculumMatches = requestedCurriculum
    ? isRecord(storedCurriculum) &&
      storedCurriculum.lesson_id === requestedCurriculum.lesson_id &&
      storedCurriculum.path_slug === requestedCurriculum.path_slug &&
      storedCurriculum.chapter_level === requestedCurriculum.chapter_level &&
      storedCurriculum.lesson_slug === requestedCurriculum.lesson_slug &&
      storedCurriculum.lesson_position === requestedCurriculum.lesson_position &&
      storedCurriculum.checkpoint === requestedCurriculum.checkpoint
    : storedCurriculum === undefined

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
    (stored.lesson_id ?? null) === (requested.curriculum?.lessonId ?? null) &&
    curriculumMatches &&
    (stored.prompt_id === requested.promptId || stored.prompt_id === null) &&
    (stored.retry_of_attempt_id === requested.retryOfAttemptId ||
      stored.retry_of_attempt_id === null) &&
    practice.target_duration_seconds === requested.targetDurationSeconds &&
    (practice.additional_context ?? undefined) === requested.additionalContext &&
    upload.storage_path === storagePath &&
    upload.mime_type === requested.mimeType

  return matches ? { storagePath } : null
}
