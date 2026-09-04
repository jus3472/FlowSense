import type { Segment } from '@/lib/results/highlights'
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
        `active-speech timing: ${cadenceLabel}`,
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
  const lines = [
    ...result.details.map((detail) =>
      detail.quote ? `“${detail.quote}” ${detail.observation}` : detail.observation,
    ),
    ...result.evidence.map(evidenceText),
  ]
  return [...new Set(lines)].map((text, index) => ({ key: `${index}:${text}`, text }))
}

interface TranscriptDeduction {
  from: number
  to: number
  label: string
}

function transcriptDeduction(
  transcript: string,
  metric: StoredV3MetricId,
  evidence: V3ScoreEvidence,
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
    label: `${V3_METRIC_LABELS[metric]}: ${evidence.detail}`,
  }
}

/** Amber marks only exact transcript evidence belonging to a metric that lost points. */
export function v3TranscriptSegments(transcript: string, payload: StoredV3ScorePayload): Segment[] {
  const candidates = v3MetricViews(payload).flatMap(({ id, result }) => {
    if (result.status !== 'scored' || result.component === null || result.component >= 1) return []
    return result.evidence.flatMap((evidence) => {
      const range = transcriptDeduction(transcript, id, evidence)
      return range ? [range] : []
    })
  })
  candidates.sort((left, right) => left.from - right.from || left.to - right.to)

  const accepted: TranscriptDeduction[] = []
  for (const candidate of candidates) {
    if (!accepted.some((range) => candidate.from < range.to && candidate.to > range.from)) {
      accepted.push(candidate)
    }
  }

  const segments: Segment[] = []
  let cursor = 0
  for (const range of accepted) {
    if (range.from > cursor)
      segments.push({ type: 'text', text: transcript.slice(cursor, range.from) })
    segments.push({
      type: 'highlight',
      text: transcript.slice(range.from, range.to),
      kind: 'word_choice',
      label: range.label,
    })
    cursor = range.to
  }
  if (cursor < transcript.length || segments.length === 0) {
    segments.push({ type: 'text', text: transcript.slice(cursor) })
  }
  return segments
}
