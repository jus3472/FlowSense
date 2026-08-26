import { SKILL_CATEGORIES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import { isV2ScorePayload, type V2ScorePayload } from '@/lib/scoring/v2/assemble'

export const RECENT_PROGRESS_WINDOW_DAYS = 7
export const LONGER_HISTORY_WINDOW_DAYS = 28
export const MINIMUM_PROGRESS_OBSERVATIONS = 2

export interface ProgressAttemptInput {
  id: string
  createdAt: string
  sectionScores: unknown
}

export interface ProgressCohort {
  scoreVersion: string
  rubricVersion: string
  mode: PracticeMode
  categoryMaxPoints: Readonly<Record<SkillCategory, number>>
}

export interface ProgressPoint {
  attemptId: string
  createdAt: string
  earnedPoints: number
  maxPoints: number
}

export interface ProgressSeries {
  points: readonly ProgressPoint[]
  valueCount: number
  state: 'ready' | 'insufficient_data'
  averagePoints: number | null
}

export interface ProgressWindow {
  attemptCount: number
  overall: ProgressSeries
  categories: Readonly<Record<SkillCategory, ProgressSeries>>
}

export interface ProgressAggregation {
  cohort: ProgressCohort | null
  counts: {
    input: number
    validV2: number
    selectedCohort: number
    excludedInvalid: number
    excludedIncompatible: number
  }
  windows: {
    all: ProgressWindow
    recent: ProgressWindow
    longerHistory: ProgressWindow
  }
}

export interface ProgressAggregationOptions {
  /** Caller-supplied time keeps boundary selection deterministic and testable. */
  now: Date
  mode?: PracticeMode
  /** Selects an exact stored-result cohort instead of choosing the latest one. */
  cohort?: ProgressCohort
}

interface AcceptedAttempt {
  id: string
  createdAt: string
  time: number
  payload: V2ScorePayload
  cohort: ProgressCohort
}

function validDate(value: string): number | null {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function cohortFor(payload: V2ScorePayload): ProgressCohort {
  return {
    scoreVersion: payload.version,
    rubricVersion: payload.rubric_version,
    mode: payload.mode,
    categoryMaxPoints: Object.fromEntries(
      SKILL_CATEGORIES.map((category) => [category, payload.categories[category].max_points]),
    ) as Record<SkillCategory, number>,
  }
}

function cohortKey(cohort: ProgressCohort): string {
  return JSON.stringify([
    cohort.scoreVersion,
    cohort.rubricVersion,
    cohort.mode,
    ...SKILL_CATEGORIES.map((category) => cohort.categoryMaxPoints[category]),
  ])
}

function emptySeries(): ProgressSeries {
  return { points: [], valueCount: 0, state: 'insufficient_data', averagePoints: null }
}

function series(points: readonly ProgressPoint[]): ProgressSeries {
  const valueCount = points.length
  return {
    points,
    valueCount,
    state: valueCount >= MINIMUM_PROGRESS_OBSERVATIONS ? 'ready' : 'insufficient_data',
    averagePoints:
      valueCount === 0
        ? null
        : points.reduce((sum, point) => sum + point.earnedPoints, 0) / valueCount,
  }
}

function emptyWindow(): ProgressWindow {
  return {
    attemptCount: 0,
    overall: emptySeries(),
    categories: Object.fromEntries(
      SKILL_CATEGORIES.map((category) => [category, emptySeries()]),
    ) as Record<SkillCategory, ProgressSeries>,
  }
}

function windowFor(attempts: readonly AcceptedAttempt[]): ProgressWindow {
  if (attempts.length === 0) return emptyWindow()
  const points = (value: (attempt: AcceptedAttempt) => ProgressPoint | null) =>
    attempts.flatMap((attempt) => {
      const point = value(attempt)
      return point ? [point] : []
    })
  const pointFor = (
    attempt: AcceptedAttempt,
    earnedPoints: number,
    maxPoints: number,
  ): ProgressPoint => ({
    attemptId: attempt.id,
    createdAt: attempt.createdAt,
    earnedPoints,
    maxPoints,
  })

  return {
    attemptCount: attempts.length,
    overall: series(
      points((attempt) =>
        attempt.payload.total_earned_points === null
          ? null
          : pointFor(
              attempt,
              attempt.payload.total_earned_points,
              attempt.payload.total_max_points,
            ),
      ),
    ),
    categories: Object.fromEntries(
      SKILL_CATEGORIES.map((category) => {
        const categoryPoints = points((attempt) => {
          const result = attempt.payload.categories[category]
          return result.status === 'scored' && result.earned_points !== null
            ? pointFor(attempt, result.earned_points, result.max_points)
            : null
        })
        return [category, series(categoryPoints)]
      }),
    ) as Record<SkillCategory, ProgressSeries>,
  }
}

function exactCohort(left: ProgressCohort, right: ProgressCohort): boolean {
  return cohortKey(left) === cohortKey(right)
}

/**
 * Aggregates only one exact stored v2 cohort. Without an explicit cohort, the
 * newest accepted attempt chooses the cohort deterministically; other modes,
 * versions, rubrics, and weight sets are excluded rather than normalized.
 */
export function aggregateV2Progress(
  input: readonly ProgressAttemptInput[],
  options: ProgressAggregationOptions,
): ProgressAggregation {
  const now = options.now.getTime()
  if (!Number.isFinite(now)) throw new Error('Progress aggregation requires a valid current time.')

  let excludedInvalid = 0
  const accepted: AcceptedAttempt[] = []
  for (const item of input) {
    const time = validDate(item.createdAt)
    if (
      typeof item.id !== 'string' ||
      item.id.length === 0 ||
      time === null ||
      time > now ||
      !isV2ScorePayload(item.sectionScores)
    ) {
      excludedInvalid += 1
      continue
    }
    const payload = item.sectionScores
    if (options.mode && payload.mode !== options.mode) continue
    accepted.push({
      id: item.id,
      createdAt: item.createdAt,
      time,
      payload,
      cohort: cohortFor(payload),
    })
  }
  accepted.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
  const selected = options.cohort
    ? options.cohort
    : accepted.length > 0
      ? (accepted.at(-1)?.cohort ?? null)
      : null
  const selectedAttempts = selected
    ? accepted.filter((attempt) => exactCohort(attempt.cohort, selected))
    : []
  const excludedIncompatible = selected ? accepted.length - selectedAttempts.length : 0
  const recentStart = now - RECENT_PROGRESS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const longerStart = now - LONGER_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000

  return {
    cohort: selected,
    counts: {
      input: input.length,
      validV2: accepted.length,
      selectedCohort: selectedAttempts.length,
      excludedInvalid,
      excludedIncompatible,
    },
    windows: {
      all: windowFor(selectedAttempts),
      recent: windowFor(selectedAttempts.filter((attempt) => attempt.time >= recentStart)),
      longerHistory: windowFor(
        selectedAttempts.filter(
          (attempt) => attempt.time >= longerStart && attempt.time < recentStart,
        ),
      ),
    },
  }
}
