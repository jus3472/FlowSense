import type {
  AudioEvaluation,
  AudioMetricEvidence,
  AudioMetricEvaluation,
  AudioMetricId,
} from '@/lib/scoring/v3/audio'
import type {
  HowYouSoundedMetricId,
  V3Measurements,
  V3MetricEvaluation,
  V3ScoreEvidence,
} from '@/lib/scoring/v3/contracts'

const PERSISTED_MEASUREMENT_KEYS: Readonly<Record<HowYouSoundedMetricId, readonly string[]>> =
  Object.freeze({
    pace: ['words_per_minute', 'word_count', 'active_speaking_ms'],
    paused_time: [
      'total_unnatural_pause_ms',
      'beginning_excessive_pause_ms',
      'natural_boundary_excessive_pause_ms',
      'mid_thought_excessive_pause_ms',
    ],
    articulation: [
      'eligible_word_count',
      'confidence_word_count',
      'low_confidence_word_count',
      'low_confidence_proportion',
    ],
    energy: [
      'pitch_range_semitones',
      'pitch_variation_semitones',
      'flat_window_proportion',
      'cadence_log_spread',
      'pitch_range_component',
      'pitch_variation_component',
      'non_monotony_component',
      'rhythm_cadence_component',
    ],
  })

function persistedMeasurements(
  metric: HowYouSoundedMetricId,
  measurements: object,
): V3Measurements {
  const source = measurements as Readonly<Record<string, unknown>>
  return Object.fromEntries(
    PERSISTED_MEASUREMENT_KEYS[metric].flatMap((key) => {
      const value = source[key]
      return value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
        ? [[key, value]]
        : []
    }),
  ) as V3Measurements
}

function scoreEvidence(evidence: AudioMetricEvidence): V3ScoreEvidence | null {
  if (
    !Number.isFinite(evidence.start) ||
    !Number.isFinite(evidence.end) ||
    evidence.start < 0 ||
    evidence.end <= evidence.start ||
    (evidence.coordinate === 'transcript_utf16' &&
      (!Number.isInteger(evidence.start) ||
        !Number.isInteger(evidence.end) ||
        (evidence.quote !== null && evidence.quote.length !== evidence.end - evidence.start)))
  ) {
    return null
  }
  return {
    source: evidence.source,
    start: evidence.start,
    end: evidence.end,
    coordinate:
      evidence.coordinate === 'transcript_utf16'
        ? { space: 'transcript', unit: 'utf16_code_unit' }
        : { space: 'audio_timeline', unit: 'millisecond' },
    quote: evidence.quote,
    detail: evidence.detail,
  }
}

function scoreMetric(metric: AudioMetricEvaluation<AudioMetricId, object>): V3MetricEvaluation {
  if (metric.status === 'unavailable') {
    return {
      metric: metric.id,
      status: 'unavailable',
      component: null,
      explanation: null,
      measurements: null,
      evidence: [],
      details: [],
      warnings: metric.warnings,
    }
  }
  const evidence = metric.evidence.flatMap((item) => {
    const converted = scoreEvidence(item)
    return converted ? [converted] : []
  })
  return {
    metric: metric.id,
    status: 'scored',
    component: metric.component,
    explanation: metric.explanation,
    measurements: persistedMeasurements(metric.id, metric.measurements),
    evidence,
    details: metric.deductions.map((deduction) => ({
      kind: deduction.metric,
      source: 'audio' as const,
      quote: null,
      observation: deduction.detail,
      suggestion: null,
      evidence,
    })),
    warnings:
      evidence.length === metric.evidence.length
        ? metric.warnings
        : [...metric.warnings, 'Invalid audio evidence was omitted.'],
  }
}

/** Converts pure audio analysis into the common v3 assembly contract. */
export function v3AudioMetrics(
  audio: AudioEvaluation,
): Record<HowYouSoundedMetricId, V3MetricEvaluation> {
  return {
    pace: scoreMetric(audio.metrics.pace),
    paused_time: scoreMetric(audio.metrics.paused_time),
    articulation: scoreMetric(audio.metrics.articulation),
    energy: scoreMetric(audio.metrics.energy),
  }
}
