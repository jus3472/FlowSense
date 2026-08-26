import type { StoredContentResult } from '@/lib/scoring/assemble'
import { CHECK_NAMES } from '@/lib/scoring/content'
import {
  DELIVERY_POINTS,
  type DeliveryMetricName,
  type MetricResult,
} from '@/lib/scoring/mechanical'
import { isV2ScorePayload, type V2ScorePayload } from '@/lib/scoring/v2/assemble'
import type { AttemptMetrics } from '@/lib/types/metrics'
import type { AttemptView } from '@/lib/results/types'

export interface StoredAttemptResultInput {
  id: string
  promptText: string
  transcript: string | null
  durationMs: number | null
  createdAt: string
  audioUrl: string | null
  score: number | null
  sectionScores: unknown
  metrics: unknown
  contentResult: unknown
}

export type ReadAttemptResult =
  | { kind: 'legacy'; attempt: AttemptView }
  | { kind: 'v2'; payload: V2ScorePayload }
  | { kind: 'incomplete' }
  | { kind: 'unsupported' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value)
}

function isLegacyMetric(value: unknown): value is MetricResult {
  return (
    isRecord(value) &&
    finiteNumber(value.points) &&
    finiteNumber(value.max_points) &&
    finiteNumber(value.raw) &&
    finiteNumber(value.component) &&
    (typeof value.label === 'string' || value.label === null)
  )
}

function isLegacySections(value: unknown): value is AttemptView['sections'] {
  if (!isRecord(value) || !isRecord(value.content) || !isRecord(value.delivery)) return false
  const { content, delivery } = value
  if (!finiteNumber(content.earned) || !finiteNumber(content.max) || !isRecord(content.checks))
    return false
  if (!finiteNumber(delivery.earned) || !finiteNumber(delivery.max) || !isRecord(delivery.metrics))
    return false
  const checks = content.checks
  const metrics = delivery.metrics
  return (
    exactKeys(checks, CHECK_NAMES) &&
    CHECK_NAMES.every((name) => finiteNumber(checks[name])) &&
    exactKeys(metrics, Object.keys(DELIVERY_POINTS)) &&
    Object.values(metrics).every(finiteNumber)
  )
}

function isLegacyContent(value: unknown): value is StoredContentResult {
  if (!isRecord(value) || !isRecord(value.checks) || !isRecord(value.points)) return false
  const checks = value.checks
  const points = value.points
  if (
    (value.status !== 'checked' && value.status !== 'not_checked') ||
    (typeof value.model !== 'string' && value.model !== null) ||
    (typeof value.error !== 'string' && value.error !== null) ||
    !Array.isArray(value.extra_spans) ||
    !Array.isArray(value.dropped) ||
    !value.extra_spans.every(
      (span) =>
        isRecord(span) &&
        typeof span.text === 'string' &&
        typeof span.category === 'string' &&
        ['padding', 'preamble', 'qualifier', 'hedge', 'imprecise'].includes(span.category),
    ) ||
    !value.dropped.every((item) => typeof item === 'string') ||
    (typeof value.tightened !== 'string' && value.tightened !== null) ||
    (value.tightened_outcome !== undefined &&
      !['none', 'clean', 'retried', 'stripped'].includes(String(value.tightened_outcome))) ||
    !finiteNumber(value.disputes_applied) ||
    !exactKeys(checks, CHECK_NAMES) ||
    !exactKeys(points, CHECK_NAMES)
  ) {
    return false
  }
  return CHECK_NAMES.every((name) => {
    const finding = checks[name]
    return (
      isRecord(finding) &&
      typeof finding.passed === 'boolean' &&
      (finding.severity === 'minor' || finding.severity === 'clear' || finding.severity === null) &&
      (typeof finding.quote === 'string' || finding.quote === null) &&
      (typeof finding.observation === 'string' || finding.observation === null) &&
      (typeof finding.suggestion === 'string' || finding.suggestion === null) &&
      finiteNumber(points[name])
    )
  })
}

function isLegacyPause(value: unknown): boolean {
  return (
    isRecord(value) &&
    finiteNumber(value.start_ms) &&
    finiteNumber(value.end_ms) &&
    finiteNumber(value.duration_ms) &&
    (value.kind === 'mid_sentence' || value.kind === 'clean') &&
    typeof value.preceding_word === 'string' &&
    typeof value.after_filler === 'boolean'
  )
}

function isLegacyFiller(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['filler', 'false_start', 'closer'].includes(String(value.category)) &&
    typeof value.subtype === 'string' &&
    typeof value.text === 'string' &&
    Array.isArray(value.token_indices) &&
    value.token_indices.every((index) => Number.isInteger(index) && index >= 0) &&
    finiteNumber(value.start) &&
    finiteNumber(value.end)
  )
}

function isLegacyStatistics(value: unknown): boolean {
  if (!isRecord(value)) return false
  const numeric = [
    'word_count',
    'recording_ms',
    'speaking_ms',
    'clean_pause_count',
    'mid_sentence_pause_count',
    'total_silence_ms',
    'leading_silence_ms',
    'trailing_silence_ms',
    'silence_ratio',
    'longest_pause_ms',
    'pace_variance',
    'backtrack_count',
    'noise_floor',
    'speech_level',
    'speech_threshold',
  ]
  return (
    numeric.every((key) => finiteNumber(value[key])) &&
    (typeof value.backtrack_note === 'string' || value.backtrack_note === null) &&
    Array.isArray(value.counted_items) &&
    value.counted_items.every(isLegacyFiller) &&
    Array.isArray(value.repeated_phrases) &&
    value.repeated_phrases.every(
      (phrase) =>
        isRecord(phrase) && typeof phrase.phrase === 'string' && finiteNumber(phrase.count),
    )
  )
}

function isTranscriptWords(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((word) => {
      if (
        !isRecord(word) ||
        typeof word.word !== 'string' ||
        !finiteNumber(word.start) ||
        !finiteNumber(word.end)
      ) {
        return false
      }
      return (
        !('confidence' in word) ||
        (finiteNumber(word.confidence) && word.confidence >= 0 && word.confidence <= 1)
      )
    })
  )
}

function isLegacyMetrics(value: unknown): value is AttemptMetrics {
  if (!isRecord(value) || !isRecord(value.delivery)) return false
  const delivery = value.delivery
  if (
    !isRecord(delivery.metrics) ||
    !isRecord(delivery.statistics) ||
    !Array.isArray(delivery.pauses)
  ) {
    return false
  }
  return (
    exactKeys(delivery.metrics, Object.keys(DELIVERY_POINTS)) &&
    Object.values(delivery.metrics).every(isLegacyMetric) &&
    isLegacyStatistics(delivery.statistics) &&
    delivery.pauses.every(isLegacyPause) &&
    (value.transcript === undefined ||
      (isRecord(value.transcript) && isTranscriptWords(value.transcript.words)))
  )
}

function legacyAttempt(input: StoredAttemptResultInput): AttemptView | null {
  if (
    !finiteNumber(input.score) ||
    !isLegacySections(input.sectionScores) ||
    !isLegacyMetrics(input.metrics) ||
    !isLegacyContent(input.contentResult)
  ) {
    return null
  }
  const delivery = input.metrics.delivery
  if (!delivery) return null

  // Every value below was structurally checked above. This copies stored JSONB
  // into the legacy renderer shape without re-running or reinterpreting scoring.
  return {
    id: input.id,
    promptText: input.promptText,
    transcript: input.transcript ?? '',
    durationMs: input.durationMs ?? 0,
    createdAt: input.createdAt,
    audioUrl: input.audioUrl,
    score: input.score,
    sections: input.sectionScores,
    metrics: delivery.metrics as Record<DeliveryMetricName, MetricResult>,
    statistics: delivery.statistics as AttemptView['statistics'],
    pauses: delivery.pauses as AttemptView['pauses'],
    words: input.metrics.transcript?.words ?? [],
    content: input.contentResult,
  }
}

/**
 * Interprets persisted result JSONB at one boundary. The payload discriminator
 * wins over row metadata: old rows can carry v2 metadata with a legacy score.
 */
export function readAttemptResult(input: StoredAttemptResultInput): ReadAttemptResult {
  if (isV2ScorePayload(input.sectionScores)) return { kind: 'v2', payload: input.sectionScores }

  const legacy = legacyAttempt(input)
  if (legacy) return { kind: 'legacy', attempt: legacy }

  if (input.score === null && input.sectionScores === null && input.contentResult === null) {
    return { kind: 'incomplete' }
  }
  const hasStoredResult =
    input.sectionScores !== null || input.contentResult !== null || input.score !== null
  return { kind: hasStoredResult ? 'unsupported' : 'incomplete' }
}

export function legacyAttemptForHome(input: StoredAttemptResultInput): AttemptView | null {
  const result = readAttemptResult(input)
  return result.kind === 'legacy' ? result.attempt : null
}
