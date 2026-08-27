import { SKILL_CATEGORIES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'
import type { V2ScorePayload } from '@/lib/scoring/v2/assemble'

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
}

export interface ProgressPoint {
  attemptId: string
  createdAt: string
  /** Normalized stored-result value, always from 0 through 100. */
  value: number
  valueOutOf: 100
}

export interface ProgressSeries {
  points: readonly ProgressPoint[]
  valueCount: number
  state: 'ready' | 'insufficient_data'
  averageValue: number | null
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
    legacy: number
    incomplete: number
    malformed: number
    unsupportedVersion: number
    excludedMode: number
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
  }
}

function cohortKey(cohort: ProgressCohort): string {
  return JSON.stringify([cohort.scoreVersion, cohort.rubricVersion])
}

function emptySeries(): ProgressSeries {
  return { points: [], valueCount: 0, state: 'insufficient_data', averageValue: null }
}

function series(points: readonly ProgressPoint[]): ProgressSeries {
  const valueCount = points.length
  return {
    points,
    valueCount,
    state: valueCount >= MINIMUM_PROGRESS_OBSERVATIONS ? 'ready' : 'insufficient_data',
    averageValue:
      valueCount === 0 ? null : points.reduce((sum, point) => sum + point.value, 0) / valueCount,
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
  const pointFor = (attempt: AcceptedAttempt, value: number): ProgressPoint => ({
    attemptId: attempt.id,
    createdAt: attempt.createdAt,
    value,
    valueOutOf: 100,
  })

  return {
    attemptCount: attempts.length,
    overall: series(
      points((attempt) =>
        attempt.payload.total_earned_points === null
          ? null
          : pointFor(attempt, attempt.payload.total_earned_points),
      ),
    ),
    categories: Object.fromEntries(
      SKILL_CATEGORIES.map((category) => {
        const categoryPoints = points((attempt) => {
          const result = attempt.payload.categories[category]
          return result.status === 'scored' && result.component !== null
            ? pointFor(attempt, result.component * 100)
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
 * Aggregates only one exact stored score-version and rubric-version cohort.
 * Modes remain an optional filter. Category values are normalized to 0 through 100
 * from their stored component, never recalculated from current rubric weights.
 */
export function aggregateV2Progress(
  input: readonly ProgressAttemptInput[],
  options: ProgressAggregationOptions,
): ProgressAggregation {
  const now = options.now.getTime()
  if (!Number.isFinite(now)) throw new Error('Progress aggregation requires a valid current time.')

  let validV2 = 0
  let legacy = 0
  let incomplete = 0
  let malformed = 0
  let unsupportedVersion = 0
  let excludedMode = 0
  const accepted: AcceptedAttempt[] = []
  for (const item of input) {
    const time = validDate(item.createdAt)
    if (typeof item.id !== 'string' || item.id.length === 0 || time === null || time > now) {
      malformed += 1
      continue
    }
    const snapshot = decodeStoredSectionSnapshot(item.sectionScores)
    if (snapshot.kind === 'none') {
      incomplete += 1
      continue
    }
    if (snapshot.kind === 'legacy') {
      legacy += 1
      continue
    }
    if (snapshot.kind === 'unsupported_version') {
      unsupportedVersion += 1
      continue
    }
    if (snapshot.kind === 'malformed') {
      malformed += 1
      continue
    }

    validV2 += 1
    const payload = snapshot.payload
    if (options.mode && payload.mode !== options.mode) {
      excludedMode += 1
      continue
    }
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
      validV2,
      selectedCohort: selectedAttempts.length,
      legacy,
      incomplete,
      malformed,
      unsupportedVersion,
      excludedMode,
      excludedInvalid: incomplete + malformed + unsupportedVersion,
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
