import type { Segment } from '@/lib/results/highlights'
import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { PracticeMode } from '@/lib/practice/contracts'
import { buildTokens } from '@/lib/scoring/tokens'
import { AUDIO_THRESHOLDS_BY_MODE } from '@/lib/scoring/v3/audio'
import { V3_CONTENT_CHECK_UNAVAILABLE_MESSAGE } from '@/lib/scoring/v3/content/contracts'
import {
  HOW_YOU_SOUNDED_METRICS,
  LEGACY_HOW_YOU_SOUNDED_METRICS,
  LEGACY_V3_METRIC_IDS,
  V3_METRIC_IDS,
  V3_METRIC_LABELS,
  V3_LEGACY_SCORE_PAYLOAD_VERSION,
  WHAT_YOU_SAID_METRICS,
  type StoredV3MetricId,
  type V3PersistedMetricScore,
  type V3ScoreEvidence,
  type StoredV3ScorePayload,
} from '@/lib/scoring/v3/contracts'

export function v3SectionViews(payload: StoredV3ScorePayload) {
  return [
    {
      id: 'what_you_said',
      label: 'What You Said',
      metrics: WHAT_YOU_SAID_METRICS,
    },
    {
      id: 'how_you_sounded',
      label: 'How You Sounded',
      metrics:
        payload.version === V3_LEGACY_SCORE_PAYLOAD_VERSION
          ? LEGACY_HOW_YOU_SOUNDED_METRICS
          : HOW_YOU_SOUNDED_METRICS,
    },
  ] as const
}

export function v3MetricIds(payload: StoredV3ScorePayload): readonly StoredV3MetricId[] {
  return payload.version === V3_LEGACY_SCORE_PAYLOAD_VERSION ? LEGACY_V3_METRIC_IDS : V3_METRIC_IDS
}

export interface V3MetricView {
  id: StoredV3MetricId
  label: string
  result: V3PersistedMetricScore
}

export function v3MetricResult(
  payload: StoredV3ScorePayload,
  id: StoredV3MetricId,
): V3PersistedMetricScore {
  const metrics = {
    ...payload.sections.what_you_said.metrics,
    ...payload.sections.how_you_sounded.metrics,
  } as Partial<Record<StoredV3MetricId, V3PersistedMetricScore>>
  const result = metrics[id]
  if (!result) throw new Error(`Stored v3 metric ${id} was missing.`)
  return result
}

export function v3MetricViews(payload: StoredV3ScorePayload): V3MetricView[] {
  return v3MetricIds(payload).map((id) => ({
    id,
    label: V3_METRIC_LABELS[id],
    result: v3MetricResult(payload, id),
  }))
}

export function v3MetricStatus(result: V3PersistedMetricScore): {
  score: string
  description: string | null
} {
  if (result.status === 'scored') {
    return { score: `${result.earned_points} / ${result.max_points}`, description: null }
  }
  if (result.status === 'not_checked') {
    return {
      score: `Not checked / ${result.max_points}`,
      description: 'This metric did not return a result.',
    }
  }
  return {
    score: `Unavailable / ${result.max_points}`,
    description: 'The evidence needed for this metric was unavailable.',
  }
}

function numericMeasurement(
  measurements: V3PersistedMetricScore['measurements'],
  key: string,
): number | null {
  const value = measurements?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function measurementSeconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)} sec`
}

export interface V3MetricMeasurementView {
  label: string
  value: string
  help: string | null
}

export interface V3MetricFindingView {
  key: string
  label: string | null
  quotes: readonly string[]
  observation: string
  suggestion: string | null
}

export interface V3MetricDetailView {
  overview: string | null
  counts: readonly V3MetricMeasurementView[]
  measurements: readonly V3MetricMeasurementView[]
  findings: readonly V3MetricFindingView[]
  evidence: readonly V3EvidenceView[]
  warnings: readonly string[]
}

function contentSummary(metric: StoredV3MetricId, result: V3PersistedMetricScore): string | null {
  const full = result.component === 1 && result.details.length === 0
  if (metric === 'answered_prompt') {
    if (result.details.some((detail) => detail.kind === 'no_prompt_answer')) {
      return 'Your response did not address what the prompt asked.'
    }
    return full
      ? 'You fully answered what the prompt asked.'
      : 'You answered part of the prompt, but one requirement was missing.'
  }
  if (metric === 'specificity') {
    return full
      ? 'You supported your response with clear, concrete details.'
      : 'You included useful detail, but part of your response needed more support.'
  }
  if (metric === 'structure') {
    return full
      ? 'Your response was organized and easy to follow.'
      : 'Your response was mostly easy to follow, with some room for clearer organization.'
  }
  if (metric === 'conciseness') {
    return full
      ? 'Your response stayed focused and avoided unnecessary wording.'
      : 'Your response stayed focused overall, but some wording was unnecessary.'
  }
  if (metric === 'word_choice') {
    return full
      ? 'Your wording was clear and precise.'
      : 'Most of your wording was clear, but one or more phrases could be more precise.'
  }
  if (metric === 'grammar') {
    return full
      ? 'Your spoken grammar was clear and easy to understand.'
      : 'Some spoken grammar made parts of your response less clear.'
  }
  return null
}

/** A short, presentation-only answer to “How did I do?” for one stored metric. */
export function v3MetricSummary(
  metric: StoredV3MetricId,
  result: V3PersistedMetricScore,
  mode: PracticeMode,
): string {
  if (result.status === 'not_checked') {
    return result.warnings.includes(V3_CONTENT_CHECK_UNAVAILABLE_MESSAGE)
      ? 'This metric was unavailable because the content check could not be completed.'
      : 'This metric could not be checked for this response.'
  }
  if (result.status === 'unavailable') {
    if (metric === 'pace')
      return 'This recording did not contain enough timed speech to measure pace.'
    if (metric === 'paused_time') {
      return 'This recording did not contain enough reliable timing evidence to measure paused time.'
    }
    if (metric === 'articulation') {
      return 'This recording did not contain enough clear speech evidence to measure articulation.'
    }
    if (metric === 'energy') {
      return 'This recording did not contain enough voiced pitch evidence to measure energy.'
    }
    return 'This metric could not be measured from this response.'
  }

  const content = contentSummary(metric, result)
  if (content) return content

  if (metric === 'pace') {
    const wpm =
      numericMeasurement(result.measurements, 'words_per_minute') ??
      numericMeasurement(result.measurements, 'articulation_rate_wpm')
    const range = AUDIO_THRESHOLDS_BY_MODE[mode].pace
    const fullPoints = result.earned_points === result.max_points
    if (wpm !== null && wpm >= range.full_from_wpm && wpm <= range.full_through_wpm) {
      return fullPoints
        ? 'Your pace was in the ideal range.'
        : 'Your pace was close to the ideal range.'
    }
    if (fullPoints) return 'Your pace was close to the ideal range.'
    if (wpm !== null && wpm > range.full_through_wpm) {
      return 'You spoke faster than the ideal range.'
    }
    if (wpm !== null && wpm < range.full_from_wpm) {
      return 'You spoke slower than the ideal range.'
    }
    return 'Your pace was measured from the available timing.'
  }

  if (metric === 'paused_time') {
    const total = numericMeasurement(result.measurements, 'total_unnatural_pause_ms')
    const midThought = numericMeasurement(result.measurements, 'mid_thought_excessive_pause_ms')
    if (total === 0 || result.earned_points === result.max_points) {
      return 'Your pauses stayed natural overall.'
    }
    if ((result.component ?? 0) < 0.75) {
      return midThought !== null && midThought > 0
        ? 'Longer pauses interrupted some of your ideas.'
        : 'Several pauses lasted beyond the natural allowance.'
    }
    if (midThought !== null && midThought > 0) {
      return 'Most pauses were natural, with some longer hesitation mid-thought.'
    }
    return 'Most pauses were natural, with a small amount of excessive paused time.'
  }

  if (metric === 'articulation') {
    const low = numericMeasurement(result.measurements, 'low_confidence_word_count')
    const eligible = numericMeasurement(result.measurements, 'eligible_word_count')
    if (low === 0) return 'Your words were consistently easy for speech recognition to understand.'
    if (
      result.earned_points === result.max_points ||
      (result.component ?? 0) >= 0.85 ||
      (low !== null && eligible !== null && low / Math.max(eligible, 1) <= 0.05)
    ) {
      return 'Nearly all of your words were easy for speech recognition to understand.'
    }
    if ((result.component ?? 0) < 0.5) {
      return 'Speech recognition was less certain about several words.'
    }
    return 'Most of your words were easy for speech recognition to understand, with a few less certain words.'
  }

  if (metric === 'energy') {
    const component = result.component ?? 0
    if (component >= 0.8) return 'You used natural variation in your pitch and speaking rhythm.'
    if (component >= 0.5) {
      return 'You used some natural vocal variation, with a few flatter or more even stretches.'
    }
    return 'Your pitch or speaking rhythm stayed fairly even through much of the response.'
  }

  if (metric === 'time_to_first_word') {
    return 'Your response includes a measured start time.'
  }
  return result.explanation ?? 'This metric was scored from the available evidence.'
}

const CONCISENESS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  filler: 'Fillers',
  false_start: 'False starts / restarts',
  repeated_idea: 'Repeated ideas',
  redundant_sentence: 'Redundant wording',
  irrelevant_content: 'Irrelevant details',
  unnecessary_tangent: 'Unnecessary tangents',
  unnecessary_qualifier: 'Unnecessary qualifiers / closers',
})

function concisenessCounts(result: V3PersistedMetricScore): V3MetricMeasurementView[] {
  const counts = new Map<string, number>()
  for (const detail of result.details) {
    const label = CONCISENESS_LABELS[detail.kind]
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].map(([label, count]) => ({ label, value: String(count), help: null }))
}

function cadenceLabel(component: number): string {
  return component >= 0.8 ? 'Varied' : component >= 0.35 ? 'Somewhat varied' : 'Fairly even'
}

function measurementViews(
  metric: StoredV3MetricId,
  result: V3PersistedMetricScore,
  mode: PracticeMode,
): V3MetricMeasurementView[] {
  if (metric === 'pace') {
    const wpm = numericMeasurement(result.measurements, 'words_per_minute')
    const duration =
      numericMeasurement(result.measurements, 'pace_duration_ms') ??
      numericMeasurement(result.measurements, 'active_speaking_ms')
    const excluded = numericMeasurement(result.measurements, 'excluded_excessive_pause_ms')
    const words = numericMeasurement(result.measurements, 'word_count')
    const range = AUDIO_THRESHOLDS_BY_MODE[mode].pace
    const rows: Array<V3MetricMeasurementView | null> = [
      wpm === null ? null : { label: 'Speaking pace', value: `${Math.round(wpm)} WPM`, help: null },
      {
        label: 'Ideal range',
        value: `${range.full_from_wpm} to ${range.full_through_wpm} WPM`,
        help: null,
      },
      duration === null
        ? null
        : { label: 'Measured response time', value: measurementSeconds(duration), help: null },
      excluded === null || excluded <= 0
        ? null
        : {
            label: 'Excessive hesitation excluded',
            value: measurementSeconds(excluded),
            help: null,
          },
      words === null ? null : { label: 'Words spoken', value: String(words), help: null },
    ]
    return rows.filter((item): item is V3MetricMeasurementView => item !== null)
  }

  if (metric === 'paused_time') {
    const rows: V3MetricMeasurementView[] = []
    const addDuration = (label: string, key: string, always = false) => {
      const value = numericMeasurement(result.measurements, key)
      if (value !== null && (always || value > 0)) {
        rows.push({ label, value: measurementSeconds(value), help: null })
      }
    }
    addDuration('Total excessive paused time', 'total_unnatural_pause_ms', true)
    addDuration('Beginning hesitation beyond allowance', 'beginning_excessive_pause_ms')
    addDuration('Mid-thought hesitation beyond allowance', 'mid_thought_excessive_pause_ms')
    addDuration('Natural-boundary time beyond allowance', 'natural_boundary_excessive_pause_ms')
    return rows
  }

  if (metric === 'articulation') {
    const low = numericMeasurement(result.measurements, 'low_confidence_word_count')
    const proportion = numericMeasurement(result.measurements, 'low_confidence_proportion')
    const rows: Array<V3MetricMeasurementView | null> = [
      low === null ? null : { label: 'Lower-confidence words', value: String(low), help: null },
      proportion === null
        ? null
        : {
            label: 'Lower-confidence rate',
            value: `${Math.round(proportion * 100)}%`,
            help: null,
          },
    ]
    return rows.filter((item): item is V3MetricMeasurementView => item !== null)
  }

  if (metric === 'energy') {
    const range = numericMeasurement(result.measurements, 'pitch_range_semitones')
    const variation = numericMeasurement(result.measurements, 'pitch_variation_semitones')
    const flat = numericMeasurement(result.measurements, 'flat_window_proportion')
    const cadence = numericMeasurement(result.measurements, 'rhythm_cadence_component')
    const rows: Array<V3MetricMeasurementView | null> = [
      range === null
        ? null
        : {
            label: 'Pitch range',
            value: `${range.toFixed(1)} semitones`,
            help: 'How wide a range of pitches your voice used.',
          },
      variation === null
        ? null
        : {
            label: 'Pitch variation',
            value: `${variation.toFixed(1)} semitones`,
            help: 'How much your pitch naturally moved while you spoke.',
          },
      flat === null
        ? null
        : {
            label: 'Flat vocal sections',
            value: `${Math.round(flat * 100)}%`,
            help: 'Whether long parts of your response stayed unusually flat.',
          },
      cadence === null
        ? null
        : {
            label: 'Speaking rhythm',
            value: cadenceLabel(cadence),
            help: 'Whether your tempo varied naturally during active speech.',
          },
    ]
    return rows.filter((item): item is V3MetricMeasurementView => item !== null)
  }

  if (metric === 'time_to_first_word') {
    const value =
      numericMeasurement(result.measurements, 'seconds') ??
      (() => {
        const milliseconds = numericMeasurement(result.measurements, 'time_to_first_word_ms')
        return milliseconds === null ? null : milliseconds / 1_000
      })()
    return value === null
      ? []
      : [{ label: 'Time to first word', value: `${value.toFixed(1)} sec`, help: null }]
  }
  return []
}

function detailEvidenceKey(evidence: V3ScoreEvidence): string {
  return [evidence.source, evidence.start, evidence.end, evidence.quote, evidence.detail].join(':')
}

function findingViews(result: V3PersistedMetricScore): V3MetricFindingView[] {
  return result.details.map((detail, index) => {
    const quotes = [
      ...(detail.quote ? [detail.quote] : []),
      ...detail.evidence.flatMap((evidence) => (evidence.quote ? [evidence.quote] : [])),
    ]
    return {
      key: `${index}:${detail.kind}:${detail.observation}`,
      label: CONCISENESS_LABELS[detail.kind] ?? null,
      quotes: [...new Set(quotes)],
      observation: detail.observation,
      suggestion: detail.suggestion,
    }
  })
}

function energyFindingViews(result: V3PersistedMetricScore): V3MetricFindingView[] | null {
  if (result.status !== 'scored' || result.earned_points === result.max_points) return []
  const pitchRange = numericMeasurement(result.measurements, 'pitch_range_component')
  const pitchVariation = numericMeasurement(result.measurements, 'pitch_variation_component')
  const nonMonotony = numericMeasurement(result.measurements, 'non_monotony_component')
  const rhythm = numericMeasurement(result.measurements, 'rhythm_cadence_component')
  if (pitchRange === null || pitchVariation === null || nonMonotony === null || rhythm === null) {
    return null
  }
  const pitchWeak = pitchRange < 1 || pitchVariation < 1
  const flatSectionsWeak = nonMonotony < 1
  const rhythmWeak = rhythm < 1
  const observation =
    pitchWeak && (flatSectionsWeak || rhythmWeak)
      ? 'Try adding a little more natural variation in your voice and rhythm.'
      : pitchWeak
        ? 'Your pitch could vary a little more throughout the response.'
        : flatSectionsWeak && rhythmWeak
          ? 'Some parts of your delivery stayed fairly flat, and your speaking rhythm stayed too even.'
          : flatSectionsWeak
            ? 'Some parts of your delivery stayed fairly flat.'
            : 'Your speaking rhythm stayed a little too even in parts.'
  return [
    {
      key: `energy:${observation}`,
      label: null,
      quotes: [],
      observation,
      suggestion: null,
    },
  ]
}

/** Friendly, metric-specific evidence derived only from the immutable stored result. */
export function v3MetricDetails(
  metric: StoredV3MetricId,
  result: V3PersistedMetricScore,
  mode: PracticeMode,
): V3MetricDetailView {
  const summary = v3MetricSummary(metric, result, mode)
  const findings =
    metric === 'energy'
      ? (energyFindingViews(result) ?? findingViews(result))
      : findingViews(result)
  const coveredEvidence = new Set(
    result.details.flatMap((detail) => detail.evidence.map(detailEvidenceKey)),
  )
  const standaloneEvidence = result.evidence.filter(
    (evidence) => !coveredEvidence.has(detailEvidenceKey(evidence)),
  )
  const userUsefulEvidence =
    metric === 'pace' || metric === 'energy'
      ? []
      : metric === 'articulation'
        ? standaloneEvidence.filter(
            (evidence) => evidence.quote && evidence.coordinate?.space === 'transcript',
          )
        : standaloneEvidence
  const showOverview = result.explanation !== null && result.explanation.trim() !== summary.trim()

  return {
    overview: showOverview ? result.explanation : null,
    counts: metric === 'conciseness' ? concisenessCounts(result) : [],
    measurements: measurementViews(metric, result, mode),
    findings,
    evidence: userUsefulEvidence.map((evidence, index) => ({
      key: `${index}:${detailEvidenceKey(evidence)}`,
      text: evidenceText(evidence),
    })),
    // Stored warnings are bounded operational diagnostics. The summaries above
    // translate unavailable states without exposing scoring internals.
    warnings: [],
  }
}

export function v3MetricHasDetails(
  metric: StoredV3MetricId,
  result: V3PersistedMetricScore,
  details: V3MetricDetailView,
): boolean {
  if (
    (metric === 'grammar' || metric === 'word_choice') &&
    result.component === 1 &&
    details.findings.length === 0 &&
    details.evidence.length === 0 &&
    details.warnings.length === 0
  ) {
    return false
  }
  if (
    metric === 'conciseness' &&
    details.counts.length === 0 &&
    details.findings.length === 0 &&
    details.evidence.length === 0 &&
    details.warnings.length === 0
  ) {
    return false
  }
  return (
    details.overview !== null ||
    details.counts.length > 0 ||
    details.measurements.length > 0 ||
    details.findings.length > 0 ||
    details.evidence.length > 0 ||
    details.warnings.length > 0
  )
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)} sec`
}

/** Returns the primary user-facing raw measurement for a sounded metric. */
export function v3PrimaryMeasurement(
  metric: StoredV3MetricId,
  result: V3PersistedMetricScore,
): string | null {
  if (metric === 'pace') {
    const value =
      numericMeasurement(result.measurements, 'words_per_minute') ??
      numericMeasurement(result.measurements, 'articulation_rate_wpm')
    return value === null ? null : `${Math.round(value)} WPM`
  }
  if (metric === 'time_to_first_word') {
    const value = numericMeasurement(result.measurements, 'seconds')
    if (value !== null) return `${value.toFixed(1)} sec`
    const milliseconds = numericMeasurement(result.measurements, 'time_to_first_word_ms')
    return milliseconds === null ? null : seconds(milliseconds)
  }
  if (metric === 'paused_time') {
    const milliseconds =
      numericMeasurement(result.measurements, 'total_unnatural_pause_ms') ??
      numericMeasurement(result.measurements, 'unnatural_pause_ms')
    return milliseconds === null ? null : seconds(milliseconds)
  }
  if (metric === 'articulation') {
    const proportion = numericMeasurement(result.measurements, 'low_confidence_proportion')
    return proportion === null ? null : `${Math.round(proportion * 100)}% low-confidence words`
  }
  if (metric === 'energy') {
    const flatProportion = numericMeasurement(result.measurements, 'flat_window_proportion')
    if (flatProportion !== null) {
      return `${Math.round((1 - flatProportion) * 100)}% vocally varied windows`
    }
    const spread = numericMeasurement(result.measurements, 'pitch_spread_semitones')
    return spread === null ? null : `${spread.toFixed(1)} semitone pitch spread`
  }
  return null
}

function measurementLabel(key: string): string {
  return key.replaceAll('_', ' ')
}

const INTERNAL_MEASUREMENT_KEYS = new Set([
  'transcript_ms',
  'amplitude_onset_ms',
  'anchored_acoustic_onset_ms',
  'selected_onset_ms',
  'rms_corroborated',
  'source',
  'origin',
])

export function v3MeasurementDetails(result: V3PersistedMetricScore): string[] {
  if (!result.measurements) return []
  if (result.metric === 'energy') {
    const range = numericMeasurement(result.measurements, 'pitch_range_semitones')
    const variation = numericMeasurement(result.measurements, 'pitch_variation_semitones')
    const flatProportion = numericMeasurement(result.measurements, 'flat_window_proportion')
    const cadence = numericMeasurement(result.measurements, 'rhythm_cadence_component')
    if (range !== null && variation !== null && flatProportion !== null && cadence !== null) {
      const cadenceLabel =
        cadence >= 0.8 ? 'varied' : cadence >= 0.35 ? 'somewhat varied' : 'fairly even'
      return [
        `central pitch range: ${range.toFixed(1)} semitones`,
        `typical pitch variation: ${variation.toFixed(1)} semitones`,
        `flatter vocal windows: ${Math.round(flatProportion * 100)}%`,
        `speaking rhythm: ${cadenceLabel}`,
      ]
    }
  }
  return Object.entries(result.measurements).flatMap(([key, value]) => {
    if (INTERNAL_MEASUREMENT_KEYS.has(key)) return []
    if (value === null) return []
    if (typeof value === 'boolean') return [`${measurementLabel(key)}: ${value ? 'yes' : 'no'}`]
    if (typeof value === 'number') {
      const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2)
      return [`${measurementLabel(key)}: ${formatted}`]
    }
    return typeof value === 'string' && value.trim() ? [`${measurementLabel(key)}: ${value}`] : []
  })
}

export interface V3EvidenceView {
  key: string
  text: string
}

function evidenceText(evidence: V3ScoreEvidence): string {
  return evidence.quote ? `“${evidence.quote}” ${evidence.detail}` : evidence.detail
}

export function v3EvidenceViews(result: V3PersistedMetricScore): V3EvidenceView[] {
  const multiSpanObservations = new Set(
    result.details
      .filter((detail) => detail.quote === null && detail.evidence.length > 1)
      .map((detail) => detail.observation),
  )
  const lines = [
    ...result.details.map((detail) =>
      detail.quote ? `“${detail.quote}” ${detail.observation}` : detail.observation,
    ),
    ...result.evidence
      .filter((evidence) => !multiSpanObservations.has(evidence.detail))
      .map(evidenceText),
  ]
  return [...new Set(lines)].map((text, index) => ({ key: `${index}:${text}`, text }))
}

interface TranscriptDeduction {
  from: number
  to: number
  details: readonly string[]
}

function transcriptDeduction(
  transcript: string,
  evidence: V3ScoreEvidence,
  details: readonly string[],
): TranscriptDeduction | null {
  if (
    evidence.coordinate?.space !== 'transcript' ||
    evidence.coordinate.unit !== 'utf16_code_unit' ||
    !Number.isInteger(evidence.start) ||
    !Number.isInteger(evidence.end) ||
    evidence.start === null ||
    evidence.end === null ||
    evidence.start < 0 ||
    evidence.end <= evidence.start ||
    evidence.end > transcript.length ||
    !evidence.quote ||
    transcript.slice(evidence.start, evidence.end) !== evidence.quote
  ) {
    return null
  }
  return {
    from: evidence.start,
    to: evidence.end,
    details,
  }
}

const LOCAL_CONTENT_METRICS = new Set<StoredV3MetricId>(['conciseness', 'word_choice', 'grammar'])

const CONCISENESS_HIGHLIGHT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  filler: 'unnecessary filler',
  false_start: 'false start or restart',
  repeated_idea: 'repeated idea',
  redundant_sentence: 'redundant wording',
  irrelevant_content: 'irrelevant detail',
  unnecessary_tangent: 'unnecessary tangent',
  unnecessary_qualifier: 'unnecessary qualifier or closer',
})

function findingHeading(metric: StoredV3MetricId, kind: string): string {
  if (metric === 'conciseness') {
    return `Conciseness: ${CONCISENESS_HIGHLIGHT_LABELS[kind] ?? 'unnecessary wording'}`
  }
  if (metric === 'word_choice') return 'Word Choice: wording that could be more precise'
  if (metric === 'grammar') return 'Grammar: spoken grammar that reduced clarity'
  return V3_METRIC_LABELS[metric]
}

function suggestionText(metric: StoredV3MetricId, suggestion: string | null): string[] {
  if (!suggestion) return []
  if (metric === 'word_choice') return [`More precise: ${suggestion}`]
  if (metric === 'grammar') return [`Clearer form: ${suggestion}`]
  return [`Try: ${suggestion}`]
}

function uniqueLines(lines: readonly string[]): string[] {
  return [...new Set(lines.map((line) => line.trim()).filter(Boolean))]
}

function contentTranscriptDeductions(
  transcript: string,
  metric: StoredV3MetricId,
  result: V3PersistedMetricScore,
): TranscriptDeduction[] {
  if (!LOCAL_CONTENT_METRICS.has(metric)) return []
  const covered = new Set<string>()
  const deductions = result.details.flatMap((detail) =>
    detail.evidence.flatMap((evidence) => {
      covered.add(detailEvidenceKey(evidence))
      const range = transcriptDeduction(
        transcript,
        evidence,
        uniqueLines([
          findingHeading(metric, detail.kind),
          detail.observation,
          ...suggestionText(metric, detail.suggestion),
        ]),
      )
      return range ? [range] : []
    }),
  )
  for (const evidence of result.evidence) {
    if (covered.has(detailEvidenceKey(evidence))) continue
    const range = transcriptDeduction(transcript, evidence, [
      findingHeading(metric, ''),
      evidence.detail,
    ])
    if (range) deductions.push(range)
  }
  return deductions
}

function validTimedTokens(transcript: string, words: readonly TranscriptWord[]) {
  const tokens = buildTokens(words, transcript)
  return tokens.length === words.length &&
    tokens.every((token) => transcript.slice(token.charStart, token.charEnd) === token.raw)
    ? tokens
    : []
}

function articulationDeductions(
  transcript: string,
  result: V3PersistedMetricScore,
): TranscriptDeduction[] {
  return result.evidence.flatMap((evidence) => {
    const range = transcriptDeduction(transcript, evidence, [
      'Articulation',
      'This word was harder for speech recognition to understand.',
    ])
    return range ? [range] : []
  })
}

function energyDeductions(
  tokens: ReturnType<typeof buildTokens>,
  result: V3PersistedMetricScore,
): TranscriptDeduction[] {
  return result.evidence.flatMap((evidence) => {
    if (
      evidence.source !== 'energy_flat_window' ||
      evidence.coordinate?.space !== 'audio_timeline' ||
      evidence.start === null ||
      evidence.end === null
    ) {
      return []
    }
    const covered = tokens.filter(
      (token) => token.start * 1_000 <= evidence.end! && token.end * 1_000 >= evidence.start!,
    )
    const first = covered[0]
    const last = covered.at(-1)
    return first && last
      ? [
          {
            from: first.charStart,
            to: last.charEnd,
            details: ['Energy', 'Your voice stayed fairly flat through this section.'],
          },
        ]
      : []
  })
}

interface TranscriptMarker {
  at: number
  text: string
  details: readonly string[]
}

function pausedTimeMarkers(
  tokens: ReturnType<typeof buildTokens>,
  result: V3PersistedMetricScore,
): TranscriptMarker[] {
  return result.evidence.flatMap((evidence) => {
    if (
      evidence.coordinate?.space !== 'audio_timeline' ||
      evidence.start === null ||
      evidence.end === null ||
      evidence.end <= evidence.start
    ) {
      return []
    }
    const before = tokens.filter((token) => token.end * 1_000 <= evidence.start!).at(-1)
    const duration = (evidence.end - evidence.start) / 1_000
    const formatted = `${duration.toFixed(1)} sec`
    return [
      {
        at: before?.charEnd ?? 0,
        text: `+${formatted}`,
        details: [
          'Paused Time',
          before
            ? `${formatted} excessive pause.`
            : `${formatted} excessive pause before you started.`,
        ],
      },
    ]
  })
}

function sameDetails(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((detail, index) => detail === right[index])
}

/** Amber marks only evidence that materially reduced displayed points and can be localized. */
export function v3TranscriptSegments(
  transcript: string,
  payload: StoredV3ScorePayload,
  words: readonly TranscriptWord[] = [],
): Segment[] {
  const tokens = validTimedTokens(transcript, words)
  const candidates: TranscriptDeduction[] = []
  const markers: TranscriptMarker[] = []
  for (const { id, result } of v3MetricViews(payload)) {
    if (
      result.status !== 'scored' ||
      result.component === null ||
      result.earned_points === null ||
      result.earned_points >= result.max_points
    ) {
      continue
    }
    candidates.push(...contentTranscriptDeductions(transcript, id, result))
    if (id === 'articulation') candidates.push(...articulationDeductions(transcript, result))
    if (id === 'energy' && tokens.length > 0) candidates.push(...energyDeductions(tokens, result))
    if (id === 'paused_time' && tokens.length > 0)
      markers.push(...pausedTimeMarkers(tokens, result))
  }

  const boundaries = [
    0,
    transcript.length,
    ...candidates.flatMap((candidate) => [candidate.from, candidate.to]),
    ...markers.map((marker) => marker.at),
  ]
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= transcript.length)
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || value !== values[index - 1])
  const segments: Segment[] = []
  const pushText = (text: string) => {
    if (!text) return
    const previous = segments.at(-1)
    if (previous?.type === 'text') previous.text += text
    else segments.push({ type: 'text', text })
  }
  const pushHighlight = (text: string, details: readonly string[]) => {
    if (!text) return
    const previous = segments.at(-1)
    if (
      previous?.type === 'highlight' &&
      sameDetails(previous.details ?? [previous.label], details)
    ) {
      previous.text += text
      return
    }
    segments.push({
      type: 'highlight',
      text,
      kind: 'word_choice',
      label: details[0] ?? 'Score deduction',
      details,
    })
  }

  for (let index = 0; index < boundaries.length; index += 1) {
    const start = boundaries[index]!
    for (const marker of markers.filter((item) => item.at === start)) {
      segments.push({
        type: 'marker',
        text: marker.text,
        label: marker.details[0] ?? 'Paused Time',
        details: marker.details,
      })
    }
    const end = boundaries[index + 1]
    if (end === undefined || end <= start) continue
    const details = uniqueLines(
      candidates
        .filter((candidate) => candidate.from < end && candidate.to > start)
        .flatMap((candidate) => candidate.details),
    )
    const text = transcript.slice(start, end)
    if (details.length > 0) pushHighlight(text, details)
    else pushText(text)
  }
  return segments.length > 0 ? segments : [{ type: 'text', text: transcript }]
}
