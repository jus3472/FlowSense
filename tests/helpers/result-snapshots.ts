import { SKILL_CATEGORIES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import type { LegacySectionSnapshot } from '@/lib/results/snapshot'
import {
  V2_SCORE_PAYLOAD_VERSION,
  type V2PersistedCategoryScore,
  type V2ScorePayload,
} from '@/lib/scoring/v2/assemble'
import { rubricFor } from '@/lib/scoring/v2/rubrics'
import { assembleV3Score } from '@/lib/scoring/v3/assemble'
import { V3_LEGACY_MODE_CONFIGS } from '@/lib/scoring/v3/config'
import {
  V3_CONTENT_EVALUATOR_VERSION,
  type V3ContentEvaluation,
  type V3ContentMetricResult,
} from '@/lib/scoring/v3/content/contracts'
import {
  HOW_YOU_SOUNDED_METRICS,
  LEGACY_HOW_YOU_SOUNDED_METRICS,
  LEGACY_V3_METRIC_IDS,
  V3_LEGACY_SCORE_PAYLOAD_VERSION,
  V3_RUBRIC_VERSION,
  WHAT_YOU_SAID_METRICS,
  type HowYouSoundedMetricId,
  type LegacyHowYouSoundedMetricId,
  type LegacyV3MetricId,
  type LegacyV3ScorePayload,
  type StoredV3MetricId,
  type V3MetricEvaluation,
  type V3MetricId,
  type V3ScoreEvidence,
  type V3ScorePayload,
  type WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'

export const legacySectionSnapshot: LegacySectionSnapshot = {
  content: {
    earned: 50,
    max: 50,
    checks: {
      answered: 14,
      explained: 12,
      word_choice: 12,
      logical_order: 7,
      no_repetition: 5,
    },
  },
  delivery: {
    earned: 50,
    max: 50,
    metrics: {
      fillers: 18,
      mid_sentence_pauses: 14,
      energy: 8,
      pace: 6,
      time_to_first_word: 4,
    },
  },
}

interface V2SnapshotOptions {
  mode?: PracticeMode
  component?: number
  unavailableCategory?: SkillCategory
  notCheckedCategory?: SkillCategory
}

export function v2Snapshot(options: V2SnapshotOptions = {}): V2ScorePayload {
  const mode = options.mode ?? 'practice'
  const component = options.component ?? 0.8
  const rubric = rubricFor(mode)
  const categories = Object.fromEntries(
    SKILL_CATEGORIES.map((category) => {
      const maxPoints = rubric.categories[category].weight
      let result: V2PersistedCategoryScore
      if (category === options.unavailableCategory) {
        result = {
          category,
          availability: 'unavailable',
          status: 'unavailable',
          component: null,
          earned_points: null,
          max_points: maxPoints,
          measurements: null,
          evidence: [],
          deductions: [],
          warnings: ['Stored evidence was unavailable.'],
        }
      } else if (category === options.notCheckedCategory) {
        result = {
          category,
          availability: 'available',
          status: 'not_checked',
          component: null,
          earned_points: null,
          max_points: maxPoints,
          measurements: {},
          evidence: [],
          deductions: [],
          warnings: ['Stored evidence was not checked.'],
        }
      } else {
        result = {
          category,
          availability: 'available',
          status: 'scored',
          component,
          earned_points: Math.round(component * maxPoints),
          max_points: maxPoints,
          measurements: {},
          evidence: [],
          deductions: [],
          warnings: [],
        }
      }
      return [category, result]
    }),
  ) as Record<SkillCategory, V2PersistedCategoryScore>
  const complete = Object.values(categories).every((category) => category.status === 'scored')

  return {
    version: V2_SCORE_PAYLOAD_VERSION,
    rubric_version: 'v2',
    mode,
    total_earned_points: complete
      ? Object.values(categories).reduce(
          (total, category) => total + (category.earned_points ?? 0),
          0,
        )
      : null,
    total_max_points: 100,
    categories,
    warnings: [],
  }
}

interface V3SnapshotOptions {
  mode?: PracticeMode
  component?: number
  unavailableMetric?: V3MetricId
  notCheckedMetric?: V3MetricId
  evidenceMetric?: V3MetricId
  evidence?: readonly V3ScoreEvidence[]
  measurements?: Readonly<Record<string, string | number | boolean | null>>
}

function v3Evaluation(
  metric: StoredV3MetricId,
  options: {
    component?: number
    unavailableMetric?: StoredV3MetricId
    notCheckedMetric?: StoredV3MetricId
    evidenceMetric?: StoredV3MetricId
    evidence?: readonly V3ScoreEvidence[]
    measurements?: Readonly<Record<string, string | number | boolean | null>>
  },
): V3MetricEvaluation {
  const unavailable = metric === options.unavailableMetric
  const notChecked = metric === options.notCheckedMetric
  if (unavailable || notChecked) {
    return {
      metric,
      status: unavailable ? 'unavailable' : 'not_checked',
      component: null,
      explanation: null,
      measurements: null,
      evidence: [],
      details: [],
      warnings: [`${metric} was not scored.`],
    }
  }
  return {
    metric,
    status: 'scored',
    component: options.component ?? 0.8,
    explanation: `You have visible ${metric} evidence.`,
    measurements: metric === options.evidenceMetric ? (options.measurements ?? {}) : {},
    evidence: metric === options.evidenceMetric ? (options.evidence ?? []) : [],
    details: [],
    warnings: [],
  }
}

export function v3Snapshot(options: V3SnapshotOptions = {}): V3ScorePayload {
  const mode = options.mode ?? 'practice'
  const content: V3ContentEvaluation = {
    version: V3_CONTENT_EVALUATOR_VERSION,
    provider: 'test',
    status: 'checked',
    metrics: Object.fromEntries(
      WHAT_YOU_SAID_METRICS.map((metric) => [
        metric,
        v3Evaluation(metric, options) as V3ContentMetricResult,
      ]),
    ) as Record<WhatYouSaidMetricId, V3ContentMetricResult>,
    warnings: [],
    calls: 1,
  }
  const sounded = Object.fromEntries(
    HOW_YOU_SOUNDED_METRICS.map((metric) => [metric, v3Evaluation(metric, options)]),
  ) as Record<HowYouSoundedMetricId, V3MetricEvaluation>

  return assembleV3Score({ mode, content, sounded })
}

interface LegacyV3SnapshotOptions extends Omit<
  V3SnapshotOptions,
  'unavailableMetric' | 'notCheckedMetric' | 'evidenceMetric'
> {
  unavailableMetric?: LegacyV3MetricId
  notCheckedMetric?: LegacyV3MetricId
  evidenceMetric?: LegacyV3MetricId
}

/** Builds an immutable v3.score.1 fixture without routing it through the current assembler. */
export function legacyV3Snapshot(options: LegacyV3SnapshotOptions = {}): LegacyV3ScorePayload {
  const mode = options.mode ?? 'practice'
  const config = V3_LEGACY_MODE_CONFIGS[mode]
  const evaluations = Object.fromEntries(
    LEGACY_V3_METRIC_IDS.map((metric) => [metric, v3Evaluation(metric, options)]),
  ) as Record<LegacyV3MetricId, V3MetricEvaluation>
  const persisted = Object.fromEntries(
    LEGACY_V3_METRIC_IDS.map((metric) => {
      const result = evaluations[metric]
      const maxPoints =
        metric in config.sections.what_you_said
          ? config.sections.what_you_said[metric as WhatYouSaidMetricId]
          : config.sections.how_you_sounded[metric as LegacyHowYouSoundedMetricId]
      return [
        metric,
        {
          ...result,
          earned_points:
            result.status === 'scored' && result.component !== null
              ? Math.round(result.component * maxPoints)
              : null,
          max_points: maxPoints,
        },
      ]
    }),
  ) as Record<LegacyV3MetricId, import('@/lib/scoring/v3/contracts').V3PersistedMetricScore>
  const whatMetrics = Object.fromEntries(
    WHAT_YOU_SAID_METRICS.map((metric) => [metric, persisted[metric]]),
  ) as Pick<typeof persisted, WhatYouSaidMetricId>
  const soundedMetrics = Object.fromEntries(
    LEGACY_HOW_YOU_SOUNDED_METRICS.map((metric) => [metric, persisted[metric]]),
  ) as Pick<typeof persisted, LegacyHowYouSoundedMetricId>
  const sectionState = (metrics: readonly (typeof persisted)[LegacyV3MetricId][]) =>
    metrics.every((metric) => metric.status === 'scored')
      ? ('scored' as const)
      : metrics.some((metric) => metric.status === 'unavailable')
        ? ('unavailable' as const)
        : ('not_checked' as const)
  const whatState = sectionState(Object.values(whatMetrics))
  const soundedState = sectionState(Object.values(soundedMetrics))
  const complete = whatState === 'scored' && soundedState === 'scored'
  const total = complete
    ? Object.values(persisted).reduce((sum, metric) => sum + (metric.earned_points ?? 0), 0)
    : null
  const scored = LEGACY_V3_METRIC_IDS.map((metric) => ({ metric, result: persisted[metric] }))
  const strongest = scored.reduce((selected, candidate) =>
    (candidate.result.component ?? -1) > (selected.result.component ?? -1) ? candidate : selected,
  )
  const weakest = [...scored]
    .reverse()
    .reduce((selected, candidate) =>
      (candidate.result.component ?? 2) < (selected.result.component ?? 2) ? candidate : selected,
    )

  return {
    version: V3_LEGACY_SCORE_PAYLOAD_VERSION,
    rubric_version: V3_RUBRIC_VERSION,
    mode,
    total_earned_points: total,
    total_max_points: 100,
    sections: {
      what_you_said: {
        section: 'what_you_said',
        status: whatState,
        earned_points:
          whatState === 'scored'
            ? Object.values(whatMetrics).reduce(
                (sum, metric) => sum + (metric.earned_points ?? 0),
                0,
              )
            : null,
        max_points: 50,
        metrics: whatMetrics,
      },
      how_you_sounded: {
        section: 'how_you_sounded',
        status: soundedState,
        earned_points:
          soundedState === 'scored'
            ? Object.values(soundedMetrics).reduce(
                (sum, metric) => sum + (metric.earned_points ?? 0),
                0,
              )
            : null,
        max_points: 50,
        metrics: soundedMetrics,
      },
    },
    recommendation: complete
      ? {
          strongest_metric: strongest.metric,
          weakest_metric: weakest.metric,
          text: `${strongest.result.explanation} ${weakest.result.explanation}`,
        }
      : null,
    warnings: [],
  }
}

export function progressAttempt(
  id: string,
  createdAt: string,
  sectionScores: unknown = v2Snapshot(),
  retryOfAttemptId: string | null = null,
) {
  return { id, createdAt, retryOfAttemptId, sectionScores }
}
