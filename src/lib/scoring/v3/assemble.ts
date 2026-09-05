import { PRACTICE_MODES, type PracticeMode } from '@/lib/practice/contracts'
import {
  V3_CONTENT_EVALUATOR_VERSION,
  type V3ContentEvaluation,
} from '@/lib/scoring/v3/content/contracts'
import { V3_MODE_CONFIGS, v3ConfigFor } from '@/lib/scoring/v3/config'
import {
  HOW_YOU_SOUNDED_METRICS,
  V3_METRIC_IDS,
  V3_RUBRIC_VERSION,
  V3_SCORE_PAYLOAD_VERSION,
  WHAT_YOU_SAID_METRICS,
  inUnitInterval,
  type HowYouSoundedMetricId,
  type V3MetricDetail,
  type V3MetricEvaluation,
  type V3MetricId,
  type V3MetricStatus,
  type V3PersistedMetricScore,
  type V3PersistedSectionScore,
  type V3Recommendation,
  type V3ScoreEvidence,
  type V3ScorePayload,
  type WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'

export interface V3AssemblyInput {
  mode: PracticeMode
  content: V3ContentEvaluation
  sounded: Readonly<Record<HowYouSoundedMetricId, V3MetricEvaluation>>
}

function unavailableMetric(
  metric: V3MetricId,
  maxPoints: number,
  status: Exclude<V3MetricStatus, 'scored'>,
  warning: string,
): V3PersistedMetricScore {
  return {
    metric,
    status,
    component: null,
    earned_points: null,
    max_points: maxPoints,
    explanation: null,
    measurements: null,
    evidence: [],
    details: [],
    warnings: [warning],
  }
}

function persistedMetric(
  metric: V3MetricId,
  evaluation: V3MetricEvaluation | undefined,
  maxPoints: number,
): V3PersistedMetricScore {
  if (!evaluation || evaluation.metric !== metric) {
    return unavailableMetric(
      metric,
      maxPoints,
      'unavailable',
      `${metric} was missing or malformed.`,
    )
  }
  if (evaluation.status !== 'scored') {
    return unavailableMetric(
      metric,
      maxPoints,
      evaluation.status,
      evaluation.warnings[0] ?? `${metric} was not scored.`,
    )
  }
  if (!inUnitInterval(evaluation.component) || !evaluation.explanation?.trim()) {
    return unavailableMetric(
      metric,
      maxPoints,
      'unavailable',
      `${metric} produced an invalid score.`,
    )
  }
  const candidate: V3PersistedMetricScore = {
    ...evaluation,
    metric,
    status: 'scored',
    explanation: evaluation.explanation.trim(),
    earned_points: Math.round(evaluation.component * maxPoints),
    max_points: maxPoints,
  }
  return validMetric(candidate, metric, maxPoints)
    ? candidate
    : unavailableMetric(metric, maxPoints, 'unavailable', `${metric} produced malformed evidence.`)
}

function sectionStatus(metrics: readonly V3PersistedMetricScore[]): V3MetricStatus {
  if (metrics.every((metric) => metric.status === 'scored')) return 'scored'
  return metrics.some((metric) => metric.status === 'unavailable') ? 'unavailable' : 'not_checked'
}

function section<Metric extends V3MetricId>(
  sectionId: 'what_you_said' | 'how_you_sounded',
  metricIds: readonly Metric[],
  evaluations: Readonly<Partial<Record<Metric, V3MetricEvaluation>>>,
  weights: Readonly<Record<Metric, number>>,
): V3PersistedSectionScore<Metric> {
  const metrics = Object.fromEntries(
    metricIds.map((metric) => [
      metric,
      persistedMetric(metric, evaluations[metric], weights[metric]),
    ]),
  ) as Record<Metric, V3PersistedMetricScore>
  const values = metricIds.map((metric) => metrics[metric])
  const status = sectionStatus(values)
  return {
    section: sectionId,
    status,
    earned_points:
      status === 'scored'
        ? values.reduce((total, metric) => total + (metric.earned_points ?? 0), 0)
        : null,
    max_points: 50,
    metrics,
  }
}

function notCheckedContentMetric(
  metric: WhatYouSaidMetricId,
  warnings: readonly string[],
): V3MetricEvaluation {
  return {
    metric,
    status: 'not_checked',
    component: null,
    explanation: null,
    measurements: null,
    evidence: [],
    details: [],
    warnings: [...warnings],
  }
}

interface RankedMetric<Metric extends V3MetricId> {
  id: Metric
  result: V3PersistedMetricScore
}

function rankedRecommendationMetrics<Metric extends V3MetricId>(
  metricIds: readonly Metric[],
  metrics: Readonly<Record<Metric, V3PersistedMetricScore>>,
): { strongest: RankedMetric<Metric>; weakest: RankedMetric<Metric> } | null {
  const scored = metricIds
    .map((id) => ({ id, result: metrics[id] }))
    .filter(
      ({ result }) =>
        result.status === 'scored' &&
        result.component !== null &&
        typeof result.explanation === 'string' &&
        result.explanation.length > 0,
    )
  if (scored.length !== metricIds.length) return null
  const strongest = scored.reduce((selected, candidate) =>
    (candidate.result.component ?? -1) > (selected.result.component ?? -1) ? candidate : selected,
  )
  const weakest = [...scored]
    .reverse()
    .reduce((selected, candidate) =>
      (candidate.result.component ?? 2) < (selected.result.component ?? 2) ? candidate : selected,
    )
  return { strongest, weakest }
}

function composeDetailedRecommendation<Metric extends V3MetricId>(
  metricIds: readonly Metric[],
  metrics: Readonly<Record<Metric, V3PersistedMetricScore>>,
): V3Recommendation<Metric> | null {
  const ranked = rankedRecommendationMetrics(metricIds, metrics)
  if (!ranked) return null
  return {
    strongest_metric: ranked.strongest.id,
    weakest_metric: ranked.weakest.id,
    text:
      ranked.strongest.id === ranked.weakest.id
        ? (ranked.strongest.result.explanation ?? '')
        : `${ranked.strongest.result.explanation} ${ranked.weakest.result.explanation}`,
  }
}

const POSITIVE_COACHING: Readonly<Record<V3MetricId, string>> = Object.freeze({
  answered_prompt: 'You did well at fully addressing what the prompt asked.',
  specificity: 'You did well at supporting your answer with concrete details.',
  structure: 'You did well at organizing your ideas clearly.',
  conciseness: 'You did well at keeping your response focused.',
  word_choice: 'You did well at choosing precise words.',
  grammar: 'You did well at using spoken grammar that kept your meaning clear.',
  pace: 'You did well at using a pace that made your ideas easy to follow.',
  paused_time: 'You did well at keeping hesitation from interrupting your response.',
  articulation: 'You did well at making your words easy to understand.',
  energy: 'You did well at using natural vocal variation.',
})

const IMPROVEMENT_COACHING: Readonly<Record<V3MetricId, string>> = Object.freeze({
  answered_prompt: 'address every part of the prompt more directly.',
  specificity: 'support your answer with more concrete details.',
  structure: 'organize your ideas in a clearer sequence.',
  conciseness: 'cut unnecessary wording and repetition.',
  word_choice: 'choose more precise words where your meaning is vague.',
  grammar: 'clean up spoken grammar that makes your meaning less clear.',
  pace: 'adjust your pace so your ideas are easier to follow.',
  paused_time: 'reduce long hesitations so your response flows more smoothly.',
  articulation: 'focus on making each word easier to understand.',
  energy: 'add more natural vocal variation so your voice sounds less flat.',
})

/** Uses only the strongest and weakest visible metrics, without raw measurements. */
export function composeV3Recommendation(
  metrics: Readonly<Record<V3MetricId, V3PersistedMetricScore>>,
): V3Recommendation | null {
  const ranked = rankedRecommendationMetrics(V3_METRIC_IDS, metrics)
  if (!ranked) return null
  const mild = (ranked.weakest.result.component ?? 0) >= 0.8
  return {
    strongest_metric: ranked.strongest.id,
    weakest_metric: ranked.weakest.id,
    text: `${POSITIVE_COACHING[ranked.strongest.id]} To improve${mild ? ' even further' : ''}, ${IMPROVEMENT_COACHING[ranked.weakest.id]}`,
  }
}

/** Converts ten normalized metric evaluations into the current immutable v3 50/50 payload. */
export function assembleV3Score(input: V3AssemblyInput): V3ScorePayload {
  const config = v3ConfigFor(input.mode)
  const contentMetrics =
    input.content.version === V3_CONTENT_EVALUATOR_VERSION && input.content.status === 'checked'
      ? input.content.metrics
      : {
          answered_prompt: notCheckedContentMetric('answered_prompt', input.content.warnings),
          specificity: notCheckedContentMetric('specificity', input.content.warnings),
          structure: notCheckedContentMetric('structure', input.content.warnings),
          conciseness: notCheckedContentMetric('conciseness', input.content.warnings),
          word_choice: notCheckedContentMetric('word_choice', input.content.warnings),
          grammar: notCheckedContentMetric('grammar', input.content.warnings),
        }
  const whatYouSaid = section(
    'what_you_said',
    WHAT_YOU_SAID_METRICS,
    contentMetrics,
    config.sections.what_you_said,
  )
  const howYouSounded = section(
    'how_you_sounded',
    HOW_YOU_SOUNDED_METRICS,
    input.sounded,
    config.sections.how_you_sounded,
  )
  const allMetrics = {
    ...whatYouSaid.metrics,
    ...howYouSounded.metrics,
  } as Record<V3MetricId, V3PersistedMetricScore>
  const complete = whatYouSaid.status === 'scored' && howYouSounded.status === 'scored'
  const total = complete
    ? (whatYouSaid.earned_points ?? 0) + (howYouSounded.earned_points ?? 0)
    : null

  return {
    version: V3_SCORE_PAYLOAD_VERSION,
    rubric_version: V3_RUBRIC_VERSION,
    mode: input.mode,
    total_earned_points: total,
    total_max_points: 100,
    sections: { what_you_said: whatYouSaid, how_you_sounded: howYouSounded },
    recommendation: complete ? composeV3Recommendation(allMetrics) : null,
    warnings: Object.values(allMetrics).flatMap((metric) => metric.warnings),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => key in value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length <= 1_000)
  )
}

function validEvidence(value: unknown): value is V3ScoreEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['source', 'start', 'end', 'coordinate', 'quote', 'detail']) ||
    typeof value.source !== 'string' ||
    value.source.length === 0 ||
    value.source.length > 100 ||
    typeof value.detail !== 'string' ||
    value.detail.length === 0 ||
    value.detail.length > 1_000 ||
    (typeof value.quote !== 'string' && value.quote !== null)
  ) {
    return false
  }
  if (value.start === null || value.end === null) {
    return (
      value.start === null &&
      value.end === null &&
      value.coordinate === null &&
      value.quote === null
    )
  }
  if (
    typeof value.start !== 'number' ||
    typeof value.end !== 'number' ||
    !Number.isFinite(value.start) ||
    !Number.isFinite(value.end) ||
    value.start < 0 ||
    value.end <= value.start ||
    !isRecord(value.coordinate) ||
    !exactKeys(value.coordinate, ['space', 'unit'])
  ) {
    return false
  }
  if (value.coordinate.space === 'transcript' && value.coordinate.unit === 'utf16_code_unit') {
    return (
      Number.isInteger(value.start) &&
      Number.isInteger(value.end) &&
      (value.quote === null || value.quote.length === value.end - value.start)
    )
  }
  return (
    value.coordinate.space === 'audio_timeline' &&
    (value.coordinate.unit === 'millisecond' || value.coordinate.unit === 'second')
  )
}

function validDetail(value: unknown): value is V3MetricDetail {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['kind', 'source', 'quote', 'observation', 'suggestion', 'evidence']) ||
    typeof value.kind !== 'string' ||
    value.kind.length === 0 ||
    value.kind.length > 100 ||
    (value.source !== 'ai' && value.source !== 'mechanical' && value.source !== 'audio') ||
    (typeof value.quote !== 'string' && value.quote !== null) ||
    typeof value.observation !== 'string' ||
    value.observation.length === 0 ||
    value.observation.length > 1_000 ||
    !(
      (typeof value.suggestion === 'string' && value.suggestion.length <= 1_000) ||
      value.suggestion === null
    ) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(validEvidence)
  ) {
    return false
  }
  return (
    value.quote === null ||
    value.evidence.some((evidence) => isRecord(evidence) && evidence.quote === value.quote)
  )
}

function validMeasurements(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      Object.values(value).every(
        (item) =>
          item === null ||
          typeof item === 'string' ||
          typeof item === 'boolean' ||
          (typeof item === 'number' && Number.isFinite(item)),
      ))
  )
}

function validMetric(
  value: unknown,
  metric: V3MetricId,
  maxPoints: number,
): value is V3PersistedMetricScore {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'metric',
      'status',
      'component',
      'earned_points',
      'max_points',
      'explanation',
      'measurements',
      'evidence',
      'details',
      'warnings',
    ]) ||
    value.metric !== metric ||
    value.max_points !== maxPoints ||
    !validMeasurements(value.measurements) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(validEvidence) ||
    !Array.isArray(value.details) ||
    !value.details.every(validDetail) ||
    !isStringArray(value.warnings)
  ) {
    return false
  }
  if (value.status === 'scored') {
    return (
      inUnitInterval(value.component) &&
      typeof value.earned_points === 'number' &&
      Number.isInteger(value.earned_points) &&
      value.earned_points === Math.round(value.component * maxPoints) &&
      typeof value.explanation === 'string' &&
      value.explanation.trim().length > 0 &&
      value.explanation.length <= 1_000
    )
  }
  return (
    (value.status === 'not_checked' || value.status === 'unavailable') &&
    value.component === null &&
    value.earned_points === null &&
    value.explanation === null &&
    value.measurements === null &&
    value.evidence.length === 0 &&
    value.details.length === 0
  )
}

function validSection<Metric extends V3MetricId>(
  value: unknown,
  sectionId: 'what_you_said' | 'how_you_sounded',
  metricIds: readonly Metric[],
  weights: Readonly<Record<Metric, number>>,
): value is V3PersistedSectionScore<Metric> {
  const metricValues = isRecord(value) && isRecord(value.metrics) ? value.metrics : null
  if (
    !isRecord(value) ||
    !exactKeys(value, ['section', 'status', 'earned_points', 'max_points', 'metrics']) ||
    value.section !== sectionId ||
    value.max_points !== 50 ||
    metricValues === null ||
    !exactKeys(metricValues, metricIds) ||
    !metricIds.every((metric) => validMetric(metricValues[metric], metric, weights[metric]))
  ) {
    return false
  }
  const metrics = metricIds.map((metric) => metricValues[metric] as V3PersistedMetricScore)
  const expectedStatus = sectionStatus(metrics)
  if (value.status !== expectedStatus) return false
  if (expectedStatus !== 'scored') return value.earned_points === null
  return (
    typeof value.earned_points === 'number' &&
    Number.isInteger(value.earned_points) &&
    value.earned_points ===
      metrics.reduce((total, metric) => total + (metric.earned_points ?? 0), 0)
  )
}

/** Validates the current immutable v3 score shape without reinterpreting older versions. */
export function isV3ScorePayload(value: unknown): value is V3ScorePayload {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'version',
      'rubric_version',
      'mode',
      'total_earned_points',
      'total_max_points',
      'sections',
      'recommendation',
      'warnings',
    ]) ||
    value.version !== V3_SCORE_PAYLOAD_VERSION ||
    value.rubric_version !== V3_RUBRIC_VERSION ||
    typeof value.mode !== 'string' ||
    !(PRACTICE_MODES as readonly string[]).includes(value.mode) ||
    value.total_max_points !== 100 ||
    !isRecord(value.sections) ||
    !exactKeys(value.sections, ['what_you_said', 'how_you_sounded']) ||
    !isStringArray(value.warnings)
  ) {
    return false
  }
  const mode = value.mode as PracticeMode
  const config = V3_MODE_CONFIGS[mode]
  if (
    !validSection(
      value.sections.what_you_said,
      'what_you_said',
      WHAT_YOU_SAID_METRICS,
      config.sections.what_you_said,
    ) ||
    !validSection(
      value.sections.how_you_sounded,
      'how_you_sounded',
      HOW_YOU_SOUNDED_METRICS,
      V3_MODE_CONFIGS[mode].sections.how_you_sounded,
    )
  ) {
    return false
  }
  const what = value.sections.what_you_said as V3PersistedSectionScore<WhatYouSaidMetricId>
  const sounded = value.sections.how_you_sounded as V3PersistedSectionScore<HowYouSoundedMetricId>
  const complete = what.status === 'scored' && sounded.status === 'scored'
  if (!complete) return value.total_earned_points === null && value.recommendation === null
  const expectedTotal = (what.earned_points ?? 0) + (sounded.earned_points ?? 0)
  if (value.total_earned_points !== expectedTotal || expectedTotal > 100) return false
  const metrics = { ...what.metrics, ...sounded.metrics } as Record<
    V3MetricId,
    V3PersistedMetricScore
  >
  const expectedRecommendation = composeV3Recommendation(metrics)
  const priorCurrentRecommendation = composeDetailedRecommendation(V3_METRIC_IDS, metrics)
  return (
    isRecord(value.recommendation) &&
    exactKeys(value.recommendation, ['strongest_metric', 'weakest_metric', 'text']) &&
    value.recommendation.strongest_metric === expectedRecommendation?.strongest_metric &&
    value.recommendation.weakest_metric === expectedRecommendation?.weakest_metric &&
    (value.recommendation.text === expectedRecommendation?.text ||
      value.recommendation.text === priorCurrentRecommendation?.text)
  )
}

export function isCurrentV3ScorePayload(value: unknown): value is V3ScorePayload {
  return isRecord(value) && value.version === V3_SCORE_PAYLOAD_VERSION && isV3ScorePayload(value)
}
