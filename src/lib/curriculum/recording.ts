import { isRetryableAttemptStatus } from '@/lib/attempts/lifecycle'
import type { CurriculumLessonSession } from '@/lib/curriculum/data'
import {
  parsePracticeSessionDescriptor,
  type PracticeSessionDescriptor,
} from '@/lib/practice/session'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Builds the only browser session shape accepted for a structured lesson. */
export function structuredPracticeSession(
  lesson: CurriculumLessonSession,
  retryOfAttemptId: string | null,
): PracticeSessionDescriptor | null {
  return parsePracticeSessionDescriptor({
    promptText: lesson.promptText,
    promptId: lesson.promptId,
    mode: lesson.mode,
    difficulty: lesson.difficulty,
    source: 'library',
    targetDurationSeconds: lesson.targetDurationSeconds,
    retryOfAttemptId,
    curriculum: {
      lessonId: lesson.lessonId,
      pathSlug: lesson.pathSlug,
      chapterLevel: lesson.chapterLevel,
      lessonSlug: lesson.lessonSlug,
      lessonPosition: lesson.lessonPosition,
      checkpoint: lesson.checkpoint,
    },
  })
}

/** Matches browser-visible fields to a fresh server-owned curriculum snapshot. */
export function matchesStructuredPracticeSession(
  requested: PracticeSessionDescriptor,
  lesson: CurriculumLessonSession,
): boolean {
  const canonical = structuredPracticeSession(lesson, requested.retryOfAttemptId)
  if (!canonical || !requested.curriculum || !canonical.curriculum) return false
  return (
    requested.promptText === canonical.promptText &&
    requested.promptId === canonical.promptId &&
    requested.mode === canonical.mode &&
    requested.difficulty === canonical.difficulty &&
    requested.source === canonical.source &&
    requested.targetDurationSeconds === canonical.targetDurationSeconds &&
    requested.additionalContext === undefined &&
    requested.curriculum.lessonId === canonical.curriculum.lessonId &&
    requested.curriculum.pathSlug === canonical.curriculum.pathSlug &&
    requested.curriculum.chapterLevel === canonical.curriculum.chapterLevel &&
    requested.curriculum.lessonSlug === canonical.curriculum.lessonSlug &&
    requested.curriculum.lessonPosition === canonical.curriculum.lessonPosition &&
    requested.curriculum.checkpoint === canonical.curriculum.checkpoint
  )
}

/** A structured retry must be a settled owned snapshot for this exact lesson. */
export function matchesStructuredRetryParent(
  parent: unknown,
  lesson: CurriculumLessonSession,
  retryOfAttemptId: string,
): boolean {
  if (
    !isRecord(parent) ||
    parent.id !== retryOfAttemptId ||
    parent.lesson_id !== lesson.lessonId ||
    !isRetryableAttemptStatus(parent.status)
  ) {
    return false
  }

  const metrics = parent.metrics
  const practice = isRecord(metrics) ? metrics.practice : undefined
  return (
    parent.prompt_id === lesson.promptId &&
    parent.prompt_text === lesson.promptText &&
    parent.practice_mode === lesson.mode &&
    parent.prompt_source === 'library' &&
    parent.prompt_difficulty === lesson.difficulty &&
    isRecord(practice) &&
    practice.target_duration_seconds === lesson.targetDurationSeconds
  )
}
