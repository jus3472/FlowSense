import { PRACTICE_MODES, type PracticeMode, type PromptSource } from '@/lib/practice/contracts'
import { PRACTICE_CATEGORIES, type PracticeCategory } from '@/lib/practice/category'
import type { ResponseCategoryFilter } from '@/lib/practice/category-filter'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'
import {
  HOW_YOU_SOUNDED_METRICS,
  V3_METRIC_IDS,
  V3_RUBRIC_VERSION,
  V3_SECTION_IDS,
  WHAT_YOU_SAID_METRICS,
  type V3Measurements,
  type V3MetricId,
  type V3PersistedMetricScore,
  type V3ScorePayload,
  type V3SectionId,
} from '@/lib/scoring/v3/contracts'

export const MINIMUM_PROGRESS_OBSERVATIONS = 2
export const COMPACT_PROGRESS_POINT_COUNT = 10

export const PROGRESS_DIMENSION_IDS = [
  'overall',
  ...V3_SECTION_IDS,
  ...WHAT_YOU_SAID_METRICS,
  ...HOW_YOU_SOUNDED_METRICS,
] as const

export type ProgressDimensionId = (typeof PROGRESS_DIMENSION_IDS)[number]
export type ProgressFilter = ResponseCategoryFilter
export type ProgressSeriesView = 'compact' | 'expanded'

export interface ProgressAttemptInput {
  id: string
  finishedAt: string
  promptText: string
  retryOfAttemptId: string | null
  score: number | null
  sectionScores: unknown
  practiceMode: PracticeMode
  promptSource: PromptSource
  category?: PracticeCategory
  rubricVersion: string
  status: 'done'
}

export interface ProgressPoint {
  attemptId: string
  finishedAt: string
  mode: PracticeMode
  promptText: string
  retryOfAttemptId: string | null
  value: number
  valueOutOf: 100
  earnedPoints: number
  maxPoints: number
  raw: { component: number; measurements: V3Measurements | null } | null
}

export interface ProgressSeries {
  points: readonly ProgressPoint[]
  observationCount: number
  latestValue: number | null
  averageValue: number | null
  state: 'empty' | 'insufficient_data' | 'ready'
}

export interface V3ProgressAggregation {
  filter: ProgressFilter
  dimensionIds: readonly ProgressDimensionId[]
  counts: {
    input: number
    included: number
    complete: number
    partial: number
    malformed: number
    unsupportedVersion: number
    metadataMismatch: number
    invalidTimestamp: number
    excludedMode: number
  }
  overall: ProgressSeries
  sections: Readonly<Record<V3SectionId, ProgressSeries>>
  metrics: Readonly<Record<V3MetricId, ProgressSeries>>
}

interface AcceptedAttempt extends ProgressAttemptInput {
  time: number
  payload: V3ScorePayload
}

function series(points: readonly ProgressPoint[]): ProgressSeries {
  return {
    points,
    observationCount: points.length,
    latestValue: points.at(-1)?.value ?? null,
    averageValue:
      points.length === 0
        ? null
        : points.reduce((total, point) => total + point.value, 0) / points.length,
    state:
      points.length === 0
        ? 'empty'
        : points.length < MINIMUM_PROGRESS_OBSERVATIONS
          ? 'insufficient_data'
          : 'ready',
  }
}

export function performancePoints(
  value: ProgressSeries,
  view: ProgressSeriesView,
): readonly ProgressPoint[] {
  return view === 'compact' ? value.points.slice(-COMPACT_PROGRESS_POINT_COUNT) : value.points
}

function metric(payload: V3ScorePayload, id: V3MetricId): V3PersistedMetricScore {
  return id in payload.sections.what_you_said.metrics
    ? payload.sections.what_you_said.metrics[
        id as keyof typeof payload.sections.what_you_said.metrics
      ]
    : payload.sections.how_you_sounded.metrics[
        id as keyof typeof payload.sections.how_you_sounded.metrics
      ]
}

function point(
  attempt: AcceptedAttempt,
  value: number,
  earnedPoints: number,
  maxPoints: number,
  raw: ProgressPoint['raw'],
): ProgressPoint {
  return {
    attemptId: attempt.id,
    finishedAt: attempt.finishedAt,
    mode: attempt.practiceMode,
    promptText: attempt.promptText,
    retryOfAttemptId: attempt.retryOfAttemptId,
    value,
    valueOutOf: 100,
    earnedPoints,
    maxPoints,
    raw,
  }
}

function validScalarScore(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100)
  )
}

/**
 * Aggregates only exact current snapshots. Stored point totals remain context;
 * cross-mode metric performance always uses the normalized component.
 */
export function aggregateV3Progress(
  input: readonly ProgressAttemptInput[],
  options: { now: Date; filter?: ProgressFilter },
): V3ProgressAggregation {
  const now = options.now.getTime()
  if (!Number.isFinite(now)) throw new Error('Progress aggregation requires a valid current time.')
  const filter = options.filter ?? 'all'
  if (
    filter !== 'all' &&
    filter !== 'custom' &&
    !(PRACTICE_CATEGORIES as readonly string[]).includes(filter)
  ) {
    throw new Error('Progress aggregation requires a valid filter.')
  }

  let malformed = 0
  let unsupportedVersion = 0
  let metadataMismatch = 0
  let invalidTimestamp = 0
  let excludedMode = 0
  const accepted: AcceptedAttempt[] = []

  for (const item of input) {
    const time = Date.parse(item.finishedAt)
    if (!Number.isFinite(time) || time > now) {
      invalidTimestamp += 1
      continue
    }
    const snapshot = decodeStoredSectionSnapshot(item.sectionScores)
    if (snapshot.kind === 'unsupported_version') {
      unsupportedVersion += 1
      continue
    }
    if (snapshot.kind !== 'v3') {
      malformed += 1
      continue
    }
    if (
      item.status !== 'done' ||
      !item.id ||
      !item.promptText.trim() ||
      item.rubricVersion !== V3_RUBRIC_VERSION ||
      snapshot.payload.rubric_version !== item.rubricVersion ||
      !(PRACTICE_MODES as readonly string[]).includes(item.practiceMode) ||
      snapshot.payload.mode !== item.practiceMode ||
      (item.promptSource !== 'library' && item.promptSource !== 'custom') ||
      (item.retryOfAttemptId !== null && typeof item.retryOfAttemptId !== 'string') ||
      !validScalarScore(item.score) ||
      item.score !== snapshot.payload.total_earned_points
    ) {
      metadataMismatch += 1
      continue
    }
    const category =
      item.promptSource === 'custom' &&
      item.practiceMode === 'practice' &&
      item.category === 'other'
        ? 'other'
        : item.practiceMode
    if (
      filter !== 'all' &&
      (filter === 'custom' ? item.promptSource !== 'custom' : category !== filter)
    ) {
      excludedMode += 1
      continue
    }
    accepted.push({ ...item, time, payload: snapshot.payload })
  }

  accepted.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))

  const overallPoints: ProgressPoint[] = []
  const sectionPoints = Object.fromEntries(
    V3_SECTION_IDS.map((id) => [id, [] as ProgressPoint[]]),
  ) as Record<V3SectionId, ProgressPoint[]>
  const metricPoints = Object.fromEntries(
    V3_METRIC_IDS.map((id) => [id, [] as ProgressPoint[]]),
  ) as Record<V3MetricId, ProgressPoint[]>

  for (const attempt of accepted) {
    const total = attempt.payload.total_earned_points
    if (total !== null) overallPoints.push(point(attempt, total, total, 100, null))

    for (const sectionId of V3_SECTION_IDS) {
      const section = attempt.payload.sections[sectionId]
      if (section.status === 'scored' && section.earned_points !== null) {
        sectionPoints[sectionId].push(
          point(
            attempt,
            (section.earned_points / section.max_points) * 100,
            section.earned_points,
            section.max_points,
            null,
          ),
        )
      }
    }

    for (const metricId of V3_METRIC_IDS) {
      const result = metric(attempt.payload, metricId)
      if (
        result.status === 'scored' &&
        result.component !== null &&
        result.earned_points !== null
      ) {
        metricPoints[metricId].push(
          point(attempt, result.component * 100, result.earned_points, result.max_points, {
            component: result.component,
            measurements: result.measurements,
          }),
        )
      }
    }
  }

  return {
    filter,
    dimensionIds: PROGRESS_DIMENSION_IDS,
    counts: {
      input: input.length,
      included: accepted.length,
      complete: overallPoints.length,
      partial: accepted.length - overallPoints.length,
      malformed,
      unsupportedVersion,
      metadataMismatch,
      invalidTimestamp,
      excludedMode,
    },
    overall: series(overallPoints),
    sections: Object.fromEntries(
      V3_SECTION_IDS.map((id) => [id, series(sectionPoints[id])]),
    ) as Record<V3SectionId, ProgressSeries>,
    metrics: Object.fromEntries(
      V3_METRIC_IDS.map((id) => [id, series(metricPoints[id])]),
    ) as Record<V3MetricId, ProgressSeries>,
  }
}
