import type { PracticeMode } from '@/lib/practice/contracts'

export const V3_RUBRIC_VERSION = 'v3' as const
export const V3_LEGACY_SCORE_PAYLOAD_VERSION = 'v3.score.1' as const
export const V3_SCORE_PAYLOAD_VERSION = 'v3.score.2' as const

export const V3_SECTION_IDS = ['what_you_said', 'how_you_sounded'] as const
export type V3SectionId = (typeof V3_SECTION_IDS)[number]

export const WHAT_YOU_SAID_METRICS = [
  'answered_prompt',
  'specificity',
  'structure',
  'conciseness',
  'word_choice',
  'grammar',
] as const
export type WhatYouSaidMetricId = (typeof WHAT_YOU_SAID_METRICS)[number]

export const HOW_YOU_SOUNDED_METRICS = ['pace', 'paused_time', 'articulation', 'energy'] as const
export type HowYouSoundedMetricId = (typeof HOW_YOU_SOUNDED_METRICS)[number]

/** Immutable metric order for historical v3.score.1 snapshots. */
export const LEGACY_HOW_YOU_SOUNDED_METRICS = [
  'pace',
  'time_to_first_word',
  'paused_time',
  'articulation',
  'energy',
] as const
export type LegacyHowYouSoundedMetricId = (typeof LEGACY_HOW_YOU_SOUNDED_METRICS)[number]

export const V3_METRIC_IDS = [...WHAT_YOU_SAID_METRICS, ...HOW_YOU_SOUNDED_METRICS] as const
export type V3MetricId = (typeof V3_METRIC_IDS)[number]
export const LEGACY_V3_METRIC_IDS = [
  ...WHAT_YOU_SAID_METRICS,
  ...LEGACY_HOW_YOU_SOUNDED_METRICS,
] as const
export type LegacyV3MetricId = (typeof LEGACY_V3_METRIC_IDS)[number]
export type StoredV3MetricId = LegacyV3MetricId

export const V3_METRIC_LABELS: Readonly<Record<StoredV3MetricId, string>> = Object.freeze({
  answered_prompt: 'Answered the Prompt',
  specificity: 'Specificity',
  structure: 'Structure',
  conciseness: 'Conciseness',
  word_choice: 'Word Choice',
  grammar: 'Grammar',
  pace: 'Pace',
  time_to_first_word: 'Time to First Word',
  paused_time: 'Paused Time',
  articulation: 'Articulation',
  energy: 'Energy',
})

export type V3MetricStatus = 'scored' | 'not_checked' | 'unavailable'

export type V3EvidenceCoordinate =
  | { space: 'transcript'; unit: 'utf16_code_unit' }
  | { space: 'audio_timeline'; unit: 'millisecond' | 'second' }

export interface V3ScoreEvidence {
  source: string
  start: number | null
  end: number | null
  coordinate: V3EvidenceCoordinate | null
  quote: string | null
  detail: string
}

export interface V3MetricDetail {
  kind: string
  source: 'ai' | 'mechanical' | 'audio'
  quote: string | null
  observation: string
  suggestion: string | null
  evidence: readonly V3ScoreEvidence[]
}

export type V3MeasurementValue = string | number | boolean | null
export type V3Measurements = Readonly<Record<string, V3MeasurementValue>>

/** A provider or deterministic analyzer produces normalized evidence, never points. */
export interface V3MetricEvaluation {
  metric: StoredV3MetricId
  status: V3MetricStatus
  component: number | null
  explanation: string | null
  measurements: V3Measurements | null
  evidence: readonly V3ScoreEvidence[]
  details: readonly V3MetricDetail[]
  warnings: readonly string[]
}

export interface V3PersistedMetricScore extends V3MetricEvaluation {
  earned_points: number | null
  max_points: number
}

export interface V3Recommendation<Metric extends StoredV3MetricId = V3MetricId> {
  strongest_metric: Metric
  weakest_metric: Metric
  text: string
}

export interface V3PersistedSectionScore<Metric extends StoredV3MetricId> {
  section: V3SectionId
  status: V3MetricStatus
  earned_points: number | null
  max_points: 50
  metrics: Readonly<Record<Metric, V3PersistedMetricScore>>
}

export interface V3ScorePayload {
  version: typeof V3_SCORE_PAYLOAD_VERSION
  rubric_version: typeof V3_RUBRIC_VERSION
  mode: PracticeMode
  total_earned_points: number | null
  total_max_points: 100
  sections: {
    what_you_said: V3PersistedSectionScore<WhatYouSaidMetricId>
    how_you_sounded: V3PersistedSectionScore<HowYouSoundedMetricId>
  }
  recommendation: V3Recommendation<V3MetricId> | null
  warnings: readonly string[]
}

export interface LegacyV3ScorePayload {
  version: typeof V3_LEGACY_SCORE_PAYLOAD_VERSION
  rubric_version: typeof V3_RUBRIC_VERSION
  mode: PracticeMode
  total_earned_points: number | null
  total_max_points: 100
  sections: {
    what_you_said: V3PersistedSectionScore<WhatYouSaidMetricId>
    how_you_sounded: V3PersistedSectionScore<LegacyHowYouSoundedMetricId>
  }
  recommendation: V3Recommendation<LegacyV3MetricId> | null
  warnings: readonly string[]
}

export type StoredV3ScorePayload = V3ScorePayload | LegacyV3ScorePayload

export function inUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}
