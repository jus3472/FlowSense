import type { Route } from 'next'
import { PATH_SLUGS, type PathSlug } from '@/lib/curriculum/contracts'
import { curriculumLessonRecordHref } from '@/lib/curriculum/routes'
import { isUuid } from '@/lib/practice/session'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolves a fresh-retry route only from the current immutable attempt snapshot. */
export function attemptRetryHref(input: {
  attemptId: string
  lessonId: string | null
  metrics: unknown
}): Route | null {
  if (!isUuid(input.attemptId)) return null
  if (input.lessonId === null) {
    return `/record?retry=${encodeURIComponent(input.attemptId)}` as Route
  }
  if (!isUuid(input.lessonId) || !isRecord(input.metrics)) return null

  const creation = input.metrics.creation
  const curriculum = isRecord(creation) ? creation.curriculum : null
  if (!isRecord(curriculum)) return null
  const pathSlug = curriculum.path_slug
  const lessonSlug = curriculum.lesson_slug
  if (
    curriculum.lesson_id !== input.lessonId ||
    !PATH_SLUGS.includes(pathSlug as PathSlug) ||
    typeof lessonSlug !== 'string' ||
    lessonSlug.trim().length === 0
  ) {
    return null
  }

  return curriculumLessonRecordHref(pathSlug as PathSlug, lessonSlug, input.attemptId)
}
