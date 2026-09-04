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
    measurements: Object.fromEntries(Object.entries(metric.measurements)) as V3Measurements,
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
    time_to_first_word: scoreMetric(audio.metrics.time_to_first_word),
    paused_time: scoreMetric(audio.metrics.paused_time),
    articulation: scoreMetric(audio.metrics.articulation),
    energy: scoreMetric(audio.metrics.energy),
  }
}
