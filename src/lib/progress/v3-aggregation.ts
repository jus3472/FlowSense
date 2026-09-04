import type { PracticeMode } from '@/lib/practice/contracts'
import type {
  ProgressAttemptInput,
  ProgressPoint,
  ProgressSeries,
} from '@/lib/progress/aggregation'
import {
  LONGER_HISTORY_WINDOW_DAYS,
  MINIMUM_PROGRESS_OBSERVATIONS,
  RECENT_PROGRESS_WINDOW_DAYS,
} from '@/lib/progress/aggregation'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'
import {
  LEGACY_V3_METRIC_IDS,
  V3_METRIC_IDS,
  V3_LEGACY_SCORE_PAYLOAD_VERSION,
  type StoredV3MetricId,
  type V3PersistedMetricScore,
  type StoredV3ScorePayload,
} from '@/lib/scoring/v3/contracts'

export interface V3ProgressWindow {
  attemptCount: number
  overall: ProgressSeries
  metrics: Readonly<Record<StoredV3MetricId, ProgressSeries>>
}

export interface V3ProgressAggregation {
  cohort: { scoreVersion: string; rubricVersion: string } | null
  metricIds: readonly StoredV3MetricId[]
  counts: {
    input: number
    validV3: number
    selectedCohort: number
    earlierV2: number
    legacy: number
    incomplete: number
    malformed: number
    unsupportedVersion: number
    excludedMode: number
    excludedIncompatible: number
  }
  windows: {
    all: V3ProgressWindow
    recent: V3ProgressWindow
    longerHistory: V3ProgressWindow
  }
}

interface AcceptedAttempt {
  id: string
  createdAt: string
  time: number
  payload: StoredV3ScorePayload
}

function emptySeries(): ProgressSeries {
  return { points: [], valueCount: 0, state: 'insufficient_data', averageValue: null }
}

function series(points: readonly ProgressPoint[]): ProgressSeries {
  return {
    points,
    valueCount: points.length,
    state: points.length >= MINIMUM_PROGRESS_OBSERVATIONS ? 'ready' : 'insufficient_data',
    averageValue:
      points.length === 0
        ? null
        : points.reduce((total, point) => total + point.value, 0) / points.length,
  }
}

function metricIdsFor(payload: StoredV3ScorePayload | null): readonly StoredV3MetricId[] {
  return payload?.version === V3_LEGACY_SCORE_PAYLOAD_VERSION ? LEGACY_V3_METRIC_IDS : V3_METRIC_IDS
}

function emptyWindow(): V3ProgressWindow {
  return {
    attemptCount: 0,
    overall: emptySeries(),
    metrics: Object.fromEntries(
      LEGACY_V3_METRIC_IDS.map((metric) => [metric, emptySeries()]),
    ) as Record<StoredV3MetricId, ProgressSeries>,
  }
}

function metric(payload: StoredV3ScorePayload, id: StoredV3MetricId): V3PersistedMetricScore {
  return id in payload.sections.what_you_said.metrics
    ? payload.sections.what_you_said.metrics[
        id as keyof typeof payload.sections.what_you_said.metrics
      ]
    : payload.sections.how_you_sounded.metrics[
        id as keyof typeof payload.sections.how_you_sounded.metrics
      ]
}

function windowFor(
  attempts: readonly AcceptedAttempt[],
  metricIds: readonly StoredV3MetricId[],
): V3ProgressWindow {
  if (attempts.length === 0) return emptyWindow()
  const point = (attempt: AcceptedAttempt, value: number): ProgressPoint => ({
    attemptId: attempt.id,
    createdAt: attempt.createdAt,
    value,
    valueOutOf: 100,
  })
  return {
    attemptCount: attempts.length,
    overall: series(
      attempts.flatMap((attempt) =>
        attempt.payload.total_earned_points === null
          ? []
          : [point(attempt, attempt.payload.total_earned_points)],
      ),
    ),
    metrics: {
      ...Object.fromEntries(LEGACY_V3_METRIC_IDS.map((id) => [id, emptySeries()])),
      ...Object.fromEntries(
        metricIds.map((id) => [
          id,
          series(
            attempts.flatMap((attempt) => {
              const result = metric(attempt.payload, id)
              return result.status === 'scored' && result.component !== null
                ? [point(attempt, result.component * 100)]
                : []
            }),
          ),
        ]),
      ),
    } as Record<StoredV3MetricId, ProgressSeries>,
  }
}

/** Aggregates v3 metrics without mapping any earlier category onto the new ontology. */
export function aggregateV3Progress(
  input: readonly ProgressAttemptInput[],
  options: { now: Date; mode?: PracticeMode },
): V3ProgressAggregation {
  const now = options.now.getTime()
  if (!Number.isFinite(now)) throw new Error('Progress aggregation requires a valid current time.')

  let validV3 = 0
  let earlierV2 = 0
  let legacy = 0
  let incomplete = 0
  let malformed = 0
  let unsupportedVersion = 0
  let excludedMode = 0
  const accepted: AcceptedAttempt[] = []

  for (const item of input) {
    const time = Date.parse(item.createdAt)
    if (!item.id || !Number.isFinite(time) || time > now) {
      malformed += 1
      continue
    }
    const snapshot = decodeStoredSectionSnapshot(item.sectionScores)
    if (snapshot.kind === 'none') incomplete += 1
    else if (snapshot.kind === 'legacy') legacy += 1
    else if (snapshot.kind === 'v2') earlierV2 += 1
    else if (snapshot.kind === 'unsupported_version') unsupportedVersion += 1
    else if (snapshot.kind === 'malformed') malformed += 1
    else {
      validV3 += 1
      if (options.mode && snapshot.payload.mode !== options.mode) excludedMode += 1
      else
        accepted.push({ id: item.id, createdAt: item.createdAt, time, payload: snapshot.payload })
    }
  }

  accepted.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
  const recentStart = now - RECENT_PROGRESS_WINDOW_DAYS * 24 * 60 * 60 * 1_000
  const longerStart = now - LONGER_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1_000
  const newest = accepted.at(-1) ?? null
  const cohort = newest
    ? {
        scoreVersion: newest.payload.version,
        rubricVersion: newest.payload.rubric_version,
      }
    : null
  const selected = cohort
    ? accepted.filter(
        (attempt) =>
          attempt.payload.version === cohort.scoreVersion &&
          attempt.payload.rubric_version === cohort.rubricVersion,
      )
    : []
  const metricIds = metricIdsFor(newest?.payload ?? null)
  const excludedIncompatibleV3 = accepted.length - selected.length

  return {
    cohort,
    metricIds,
    counts: {
      input: input.length,
      validV3,
      selectedCohort: selected.length,
      earlierV2,
      legacy,
      incomplete,
      malformed,
      unsupportedVersion,
      excludedMode,
      excludedIncompatible:
        earlierV2 + legacy + incomplete + malformed + unsupportedVersion + excludedIncompatibleV3,
    },
    windows: {
      all: windowFor(selected, metricIds),
      recent: windowFor(
        selected.filter((attempt) => attempt.time >= recentStart),
        metricIds,
      ),
      longerHistory: windowFor(
        selected.filter((attempt) => attempt.time >= longerStart && attempt.time < recentStart),
        metricIds,
      ),
    },
  }
}
