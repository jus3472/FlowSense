import { SKILL_CATEGORIES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import type { LegacySectionSnapshot } from '@/lib/results/snapshot'
import { assembleV3Score } from '@/lib/scoring/v3/assemble'
import {
  V3_CONTENT_EVALUATOR_VERSION,
  type V3ContentEvaluation,
  type V3ContentMetricResult,
} from '@/lib/scoring/v3/content/contracts'
import {
  HOW_YOU_SOUNDED_METRICS,
  WHAT_YOU_SAID_METRICS,
  type HowYouSoundedMetricId,
  type V3MetricEvaluation,
  type V3MetricId,
  type V3ScorePayload,
  type WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'
import {
  V2_SCORE_PAYLOAD_VERSION,
  type V2PersistedCategoryScore,
  type V2ScorePayload,
} from '@/lib/scoring/v2/assemble'
import { rubricFor } from '@/lib/scoring/v2/rubrics'

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
  notCheckedMetric?: WhatYouSaidMetricId
  unavailableMetric?: HowYouSoundedMetricId
}

function v3Evaluation(
  metric: V3MetricId,
  component: number,
  status: 'scored' | 'not_checked' | 'unavailable' = 'scored',
): V3MetricEvaluation {
  if (status !== 'scored') {
    return {
      metric,
      status,
      component: null,
      explanation: null,
      measurements: null,
      evidence: [],
      details: [],
      warnings: [`${metric} was unavailable in this fixture.`],
    }
  }
  return {
    metric,
    status: 'scored',
    component,
    explanation: `You have measured ${metric} evidence.`,
    measurements: {},
    evidence: [],
    details: [],
    warnings: [],
  }
}

export function v3Snapshot(options: V3SnapshotOptions = {}): V3ScorePayload {
  const mode = options.mode ?? 'practice'
  const component = options.component ?? 0.8
  const content: V3ContentEvaluation = {
    version: V3_CONTENT_EVALUATOR_VERSION,
    provider: 'fixture',
    status: 'checked',
    metrics: Object.fromEntries(
      WHAT_YOU_SAID_METRICS.map((metric) => [
        metric,
        v3Evaluation(
          metric,
          component,
          metric === options.notCheckedMetric ? 'not_checked' : 'scored',
        ),
      ]),
    ) as Record<WhatYouSaidMetricId, V3ContentMetricResult>,
    warnings: [],
    calls: 1,
  }
  const sounded = Object.fromEntries(
    HOW_YOU_SOUNDED_METRICS.map((metric) => [
      metric,
      v3Evaluation(
        metric,
        component,
        metric === options.unavailableMetric ? 'unavailable' : 'scored',
      ),
    ]),
  ) as Record<HowYouSoundedMetricId, V3MetricEvaluation>
  return assembleV3Score({ mode, content, sounded })
}

export function progressAttempt(
  id: string,
  createdAt: string,
  sectionScores: unknown = v2Snapshot(),
  retryOfAttemptId: string | null = null,
) {
  return { id, createdAt, retryOfAttemptId, sectionScores }
}
