import { analyseEnergy } from '@/lib/scoring/energy'
import { analyseFillers, type FillerAnalysis } from '@/lib/scoring/fillers'
import { analysePace } from '@/lib/scoring/pace'
import { analysePauses, type Pause, type PauseAnalysis } from '@/lib/scoring/pauses'
import { paceVariance, repeatedPhrases, type RepeatedPhrase } from '@/lib/scoring/statistics'
import { earnedPoints, ramp } from '@/lib/scoring/scale'
import { analyseTimeToFirstWord } from '@/lib/scoring/time-to-first-word'
import { buildTokens } from '@/lib/scoring/tokens'
import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { CaptureMetrics } from '@/lib/types/metrics'

export const DELIVERY_POINTS = {
  fillers: 18,
  mid_sentence_pauses: 14,
  energy: 8,
  pace: 6,
  time_to_first_word: 4,
} as const

export type DeliveryMetricName = keyof typeof DELIVERY_POINTS

export interface MetricResult {
  points: number
  max_points: number
  /** The measurement itself, in the metric's own units. */
  raw: number
  component: number
  label: string | null
}

export type DeliveryMetrics = Record<DeliveryMetricName, MetricResult>

export interface DeliveryStatistics {
  word_count: number
  recording_ms: number
  speaking_ms: number
  clean_pause_count: number
  mid_sentence_pause_count: number
  total_silence_ms: number
  leading_silence_ms: number
  trailing_silence_ms: number
  silence_ratio: number
  longest_pause_ms: number
  pace_variance: number
  backtrack_count: number
  backtrack_note: string | null
  /** Every token charged as a filler, so a wrong count can be traced. */
  counted_items: FillerAnalysis['hits']
  repeated_phrases: RepeatedPhrase[]
  noise_floor: number
  speech_level: number
  speech_threshold: number
}

export interface MechanicalResult {
  metrics: DeliveryMetrics
  statistics: DeliveryStatistics
  pauses: Pause[]
  delivery_points: number
  warnings: string[]
}

/** Below this rate, fillers cost nothing. Named so the results view can say so. */
export const FILLER_FREE_RATE = 1

/** Under a second is ordinary speech rhythm and costs nothing. */
export function pauseSeverity(durationMs: number): number {
  const seconds = durationMs / 1000
  if (seconds < 1) return 0
  if (seconds >= 2.5) return 1
  return (seconds - 1) / 1.5
}

export function pauseBurden(pauses: readonly Pause[], durationMs: number): number {
  const total = pauses.reduce((sum, pause) => sum + pauseSeverity(pause.duration_ms), 0)
  const minutes = durationMs / 60_000
  return minutes > 0 ? total / minutes : 0
}

const BACKTRACK_NOTE_THRESHOLD = 4

export function computeMechanical(
  capture: CaptureMetrics,
  words: readonly TranscriptWord[],
  transcript: string,
): MechanicalResult {
  const warnings: string[] = []
  const durationMs = capture.duration_ms
  const tokens = buildTokens(words, transcript)
  const wordCount = tokens.length

  // Fillers first: pause classification has to see past a hesitation sound to
  // the last word that carried meaning.
  const fillers = analyseFillers(tokens, wordCount)
  const fillerIndices = new Set(
    fillers.hits.filter((hit) => hit.category === 'filler').flatMap((hit) => hit.token_indices),
  )
  const pauseAnalysis: PauseAnalysis = analysePauses(
    capture.amplitude,
    words,
    durationMs,
    fillerIndices,
  )
  const energy = analyseEnergy(capture.pitch)
  const pace = analysePace(wordCount, durationMs, pauseAnalysis.total_silence_ms)
  const ttfw = analyseTimeToFirstWord(words, pauseAnalysis.speech_onset_ms)
  if (ttfw.warning) warnings.push(ttfw.warning)
  // A metric that silently returns a perfect score is worse than one that errors.
  for (const warning of pauseAnalysis.warnings) warnings.push(warning)

  const fillerComponent = ramp(fillers.rate_per_100_words, FILLER_FREE_RATE, 9)
  const burden = pauseBurden(pauseAnalysis.mid_sentence, durationMs)
  const pauseComponent = ramp(burden, 0.4, 3.4)

  const metrics: DeliveryMetrics = {
    fillers: {
      points: earnedPoints(DELIVERY_POINTS.fillers, fillerComponent),
      max_points: DELIVERY_POINTS.fillers,
      raw: fillers.rate_per_100_words,
      component: fillerComponent,
      label: `${fillers.counted_tokens} per ${wordCount} words`,
    },
    mid_sentence_pauses: {
      points: earnedPoints(DELIVERY_POINTS.mid_sentence_pauses, pauseComponent),
      max_points: DELIVERY_POINTS.mid_sentence_pauses,
      raw: burden,
      component: pauseComponent,
      label: `${pauseAnalysis.mid_sentence.length} mid-sentence`,
    },
    energy: {
      points: earnedPoints(DELIVERY_POINTS.energy, energy.component),
      max_points: DELIVERY_POINTS.energy,
      raw: energy.semitones,
      component: energy.component,
      label: energy.descriptor,
    },
    pace: {
      points: earnedPoints(DELIVERY_POINTS.pace, pace.component),
      max_points: DELIVERY_POINTS.pace,
      raw: pace.words_per_minute,
      component: pace.component,
      label: `${Math.round(pace.words_per_minute)} wpm`,
    },
    time_to_first_word: {
      points: earnedPoints(DELIVERY_POINTS.time_to_first_word, ttfw.component),
      max_points: DELIVERY_POINTS.time_to_first_word,
      raw: ttfw.seconds,
      component: ttfw.component,
      label: `${ttfw.seconds.toFixed(2)}s from ${ttfw.source}`,
    },
  }

  const backtrackCount = fillers.backtracks.length

  const statistics: DeliveryStatistics = {
    word_count: wordCount,
    recording_ms: durationMs,
    speaking_ms: pace.speaking_ms,
    clean_pause_count: pauseAnalysis.clean.length,
    mid_sentence_pause_count: pauseAnalysis.mid_sentence.length,
    total_silence_ms: pauseAnalysis.total_silence_ms,
    leading_silence_ms: pauseAnalysis.leading_silence_ms,
    trailing_silence_ms: pauseAnalysis.trailing_silence_ms,
    silence_ratio: durationMs > 0 ? pauseAnalysis.total_silence_ms / durationMs : 0,
    longest_pause_ms: pauseAnalysis.longest_pause_ms,
    pace_variance: paceVariance(tokens),
    backtrack_count: backtrackCount,
    backtrack_note:
      backtrackCount >= BACKTRACK_NOTE_THRESHOLD
        ? 'You restarted your point several times, so the idea may still have been forming.'
        : null,
    counted_items: fillers.hits,
    repeated_phrases: repeatedPhrases(tokens),
    noise_floor: pauseAnalysis.noise_floor,
    speech_level: pauseAnalysis.speech_level,
    speech_threshold: pauseAnalysis.speech_threshold,
  }

  const deliveryPoints = Object.values(metrics).reduce((sum, metric) => sum + metric.points, 0)

  return {
    metrics,
    statistics,
    pauses: pauseAnalysis.pauses,
    delivery_points: deliveryPoints,
    warnings,
  }
}
