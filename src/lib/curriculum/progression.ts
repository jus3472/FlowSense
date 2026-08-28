import type { LessonState } from '@/lib/curriculum/contracts'
import { isPassingScore, parseCurriculumScore } from '@/lib/curriculum/thresholds'

export interface LessonAttemptCandidate {
  attemptId: string
  score: unknown
  finishedAt: unknown
}

export interface BestLessonAttempt {
  attemptId: string
  score: number
  /** A valid stored date string, or null when the attempt has no usable completion time. */
  finishedAt: string | null
}

export interface LessonStateInput {
  unlocked: boolean
  bestScore: unknown
}

function parseFinishedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return Number.isFinite(Date.parse(value)) ? value : null
}

function normalizeAttempt(candidate: LessonAttemptCandidate): BestLessonAttempt | null {
  const score = parseCurriculumScore(candidate.score)
  if (score === null || candidate.attemptId.length === 0) return null
  return {
    attemptId: candidate.attemptId,
    score,
    finishedAt: parseFinishedAt(candidate.finishedAt),
  }
}

function compareAttemptIds(left: string, right: string): number {
  if (left === right) return 0
  return left > right ? 1 : -1
}

/** Positive means left is the preferred best-attempt record. */
function compareAttempts(left: BestLessonAttempt, right: BestLessonAttempt): number {
  if (left.score !== right.score) return left.score - right.score

  const leftTime = left.finishedAt === null ? null : Date.parse(left.finishedAt)
  const rightTime = right.finishedAt === null ? null : Date.parse(right.finishedAt)
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return leftTime - rightTime
  }
  if (leftTime !== null && rightTime === null) return 1
  if (leftTime === null && rightTime !== null) return -1
  return compareAttemptIds(left.attemptId, right.attemptId)
}

/**
 * Selects a monotonic best from any input order. Invalid and neutral scores are ignored.
 * Equal scores prefer the newest valid completion time, followed by attempt id.
 */
export function selectBestAttempt(
  candidates: readonly LessonAttemptCandidate[],
): BestLessonAttempt | null {
  let best: BestLessonAttempt | null = null
  for (const candidate of candidates) {
    const normalized = normalizeAttempt(candidate)
    if (normalized !== null && (best === null || compareAttempts(normalized, best) > 0)) {
      best = normalized
    }
  }
  return best
}

/**
 * Applies one retry without allowing a lower or malformed score to reduce stored progress.
 */
export function mergeBestAttempt(
  current: LessonAttemptCandidate | null,
  retry: LessonAttemptCandidate,
): BestLessonAttempt | null {
  return selectBestAttempt(current === null ? [retry] : [current, retry])
}

export function lessonStateFor({ unlocked, bestScore }: LessonStateInput): LessonState {
  if (!unlocked) return 'locked'
  const score = parseCurriculumScore(bestScore)
  if (score === null) return 'available'
  return isPassingScore(score) ? 'passed' : 'retry_required'
}
