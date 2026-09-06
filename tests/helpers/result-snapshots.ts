import type { PracticeMode } from '@/lib/practice/contracts'
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
  type V3ScoreEvidence,
  type V3ScorePayload,
  type WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'

interface V3SnapshotOptions {
  mode?: PracticeMode
  component?: number
  components?: Partial<Readonly<Record<V3MetricId, number>>>
  unavailableMetric?: V3MetricId
  notCheckedMetric?: V3MetricId
  evidenceMetric?: V3MetricId
  evidence?: readonly V3ScoreEvidence[]
  measurements?: Readonly<Record<string, string | number | boolean | null>>
}

function v3Evaluation(metric: V3MetricId, options: V3SnapshotOptions): V3MetricEvaluation {
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
    component: options.components?.[metric] ?? options.component ?? 0.8,
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

export function progressAttempt(
  id: string,
  finishedAt: string,
  sectionScores: unknown = v3Snapshot(),
  retryOfAttemptId: string | null = null,
  overrides: Partial<{
    promptText: string
    score: number | null
    practiceMode: PracticeMode
    promptSource: 'library' | 'custom'
    rubricVersion: string
    status: 'done'
  }> = {},
) {
  const snapshot = sectionScores as Partial<V3ScorePayload> | null
  return {
    id,
    finishedAt,
    promptText: `Prompt ${id}`,
    retryOfAttemptId,
    score: snapshot?.total_earned_points ?? null,
    sectionScores,
    practiceMode: snapshot?.mode ?? 'practice',
    promptSource: 'library' as const,
    rubricVersion: snapshot?.rubric_version ?? 'v3',
    status: 'done' as const,
    ...overrides,
  }
}
