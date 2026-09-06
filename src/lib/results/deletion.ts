import type { Route } from 'next'
import { parsePathSlug } from '@/lib/curriculum/data'
import { attemptResultHref, curriculumPathHref } from '@/lib/curriculum/routes'

export interface AttemptDeletionReceipt {
  deleted: boolean
  lessonId: string | null
  bestAttemptId: string | null
  pathSlug: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/** Parses the bounded row returned by the transactional deletion function. */
export function parseAttemptDeletionReceipt(value: unknown): AttemptDeletionReceipt | null {
  const row = Array.isArray(value) ? value[0] : value
  if (
    !isRecord(row) ||
    typeof row.deleted !== 'boolean' ||
    !nullableString(row.lesson_id) ||
    !nullableString(row.best_attempt_id) ||
    !nullableString(row.path_slug)
  ) {
    return null
  }

  return {
    deleted: row.deleted,
    lessonId: row.lesson_id,
    bestAttemptId: row.best_attempt_id,
    pathSlug: row.path_slug,
  }
}

/** Chooses a valid internal destination after the viewed attempt disappears. */
export function deletedAttemptDestination(receipt: AttemptDeletionReceipt): Route {
  if (receipt.lessonId !== null && receipt.bestAttemptId !== null) {
    return attemptResultHref(receipt.bestAttemptId)
  }

  if (receipt.lessonId !== null) {
    const pathSlug = parsePathSlug(receipt.pathSlug)
    if (pathSlug !== null) return curriculumPathHref(pathSlug)
  }

  return '/history'
}
