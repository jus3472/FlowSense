import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { PracticeMode } from '@/lib/practice/contracts'
import { MIN_PITCH_HZ, MAX_PITCH_HZ } from '@/lib/recording/signal'
import { analyseFillers } from '@/lib/scoring/fillers'
import { correctOctaves } from '@/lib/scoring/energy'
import { FUNCTION_WORDS } from '@/lib/scoring/lexicon'
import { analysePauses, type Pause, type PauseAnalysis } from '@/lib/scoring/pauses'
import { clamp01, median, medianAbsoluteDeviation } from '@/lib/scoring/scale'
import { buildTokens, normalizeWord, type Token } from '@/lib/scoring/tokens'
import type { CaptureMetrics } from '@/lib/types/metrics'

export const AUDIO_ANALYSIS_VERSION = 'v3.audio.4' as const

export const AUDIO_METRIC_IDS = ['pace', 'paused_time', 'articulation', 'energy'] as const

export type AudioMetricId = (typeof AUDIO_METRIC_IDS)[number]

export interface AudioModeThresholds {
  readonly pace: {
    readonly zero_below_wpm: number
    readonly full_from_wpm: number
    readonly full_through_wpm: number
    readonly zero_above_wpm: number
  }
  readonly paused_time: {
    readonly candidate_gap_ms: number
    readonly mid_thought_allowance_ms: number
    readonly natural_boundary_allowance_ms: number
    readonly very_long_pause_ms: number
    readonly full_through_ms: number
    readonly zero_at_ms: number
  }
  readonly articulation: {
    readonly low_confidence_below: number
    readonly full_through_low_proportion: number
    readonly zero_at_low_proportion: number
    readonly globally_uncertain_at: number
  }
  readonly energy: {
    readonly pitch_range: {
      readonly zero_through_semitones: number
      readonly full_from_semitones: number
    }
    readonly pitch_variation: {
      readonly zero_through_semitones: number
      readonly full_from_semitones: number
    }
    readonly non_monotony: {
      readonly flat_window_through_semitones: number
      readonly full_through_flat_proportion: number
      readonly zero_at_flat_proportion: number
    }
    readonly rhythm_cadence: {
      readonly zero_through_log_spread: number
      readonly full_from_log_spread: number
    }
  }
}

function frozenThresholds(value: AudioModeThresholds): AudioModeThresholds {
  return Object.freeze({
    pace: Object.freeze(value.pace),
    paused_time: Object.freeze(value.paused_time),
    articulation: Object.freeze(value.articulation),
    energy: Object.freeze({
      pitch_range: Object.freeze(value.energy.pitch_range),
      pitch_variation: Object.freeze(value.energy.pitch_variation),
      non_monotony: Object.freeze(value.energy.non_monotony),
      rhythm_cadence: Object.freeze(value.energy.rhythm_cadence),
    }),
  })
}

/**
 * Mode-specific measurement thresholds. Metric weights live in the scoring definition.
 * Each component is piecewise linear between named anchors so product tuning remains
 * explicit: pace has a natural band, paused time totals only silence beyond contextual
 * allowances, confidence is a low-word proportion, and Energy combines four
 * independently calibrated pitch and active-speech timing signals.
 */
export const AUDIO_THRESHOLDS_BY_MODE: Readonly<Record<PracticeMode, AudioModeThresholds>> =
  Object.freeze({
    practice: frozenThresholds({
      pace: {
        zero_below_wpm: 70,
        full_from_wpm: 120,
        full_through_wpm: 175,
        zero_above_wpm: 235,
      },
      paused_time: {
        candidate_gap_ms: 350,
        mid_thought_allowance_ms: 650,
        natural_boundary_allowance_ms: 1_100,
        very_long_pause_ms: 3_000,
        full_through_ms: 750,
        zero_at_ms: 8_000,
      },
      articulation: {
        low_confidence_below: 0.65,
        full_through_low_proportion: 0.05,
        zero_at_low_proportion: 0.45,
        globally_uncertain_at: 0.6,
      },
      energy: {
        pitch_range: { zero_through_semitones: 2, full_from_semitones: 5.5 },
        pitch_variation: { zero_through_semitones: 1.2, full_from_semitones: 2.8 },
        non_monotony: {
          flat_window_through_semitones: 0.55,
          full_through_flat_proportion: 0.25,
          zero_at_flat_proportion: 0.85,
        },
        rhythm_cadence: { zero_through_log_spread: 0.04, full_from_log_spread: 0.22 },
      },
    }),
    interview: frozenThresholds({
      pace: {
        zero_below_wpm: 65,
        full_from_wpm: 115,
        full_through_wpm: 170,
        zero_above_wpm: 225,
      },
      paused_time: {
        candidate_gap_ms: 350,
        mid_thought_allowance_ms: 600,
        natural_boundary_allowance_ms: 1_000,
        very_long_pause_ms: 2_750,
        full_through_ms: 500,
        zero_at_ms: 6_500,
      },
      articulation: {
        low_confidence_below: 0.65,
        full_through_low_proportion: 0.05,
        zero_at_low_proportion: 0.4,
        globally_uncertain_at: 0.6,
      },
      energy: {
        pitch_range: { zero_through_semitones: 2, full_from_semitones: 5.5 },
        pitch_variation: { zero_through_semitones: 1.2, full_from_semitones: 2.8 },
        non_monotony: {
          flat_window_through_semitones: 0.55,
          full_through_flat_proportion: 0.25,
          zero_at_flat_proportion: 0.8,
        },
        rhythm_cadence: { zero_through_log_spread: 0.04, full_from_log_spread: 0.22 },
      },
    }),
    presentation: frozenThresholds({
      pace: {
        zero_below_wpm: 60,
        full_from_wpm: 110,
        full_through_wpm: 165,
        zero_above_wpm: 220,
      },
      paused_time: {
        candidate_gap_ms: 350,
        mid_thought_allowance_ms: 750,
        natural_boundary_allowance_ms: 1_200,
        very_long_pause_ms: 3_250,
        full_through_ms: 1_000,
        zero_at_ms: 7_500,
      },
      articulation: {
        low_confidence_below: 0.65,
        full_through_low_proportion: 0.05,
        zero_at_low_proportion: 0.4,
        globally_uncertain_at: 0.6,
      },
      energy: {
        pitch_range: { zero_through_semitones: 2.5, full_from_semitones: 6.5 },
        pitch_variation: { zero_through_semitones: 1.4, full_from_semitones: 3 },
        non_monotony: {
          flat_window_through_semitones: 0.65,
          full_through_flat_proportion: 0.2,
          zero_at_flat_proportion: 0.8,
        },
        rhythm_cadence: { zero_through_log_spread: 0.05, full_from_log_spread: 0.25 },
      },
    }),
    conversation: frozenThresholds({
      pace: {
        zero_below_wpm: 75,
        full_from_wpm: 125,
        full_through_wpm: 185,
        zero_above_wpm: 245,
      },
      paused_time: {
        candidate_gap_ms: 350,
        mid_thought_allowance_ms: 550,
        natural_boundary_allowance_ms: 900,
        very_long_pause_ms: 2_750,
        full_through_ms: 500,
        zero_at_ms: 6_000,
      },
      articulation: {
        low_confidence_below: 0.65,
        full_through_low_proportion: 0.05,
        zero_at_low_proportion: 0.45,
        globally_uncertain_at: 0.6,
      },
      energy: {
        pitch_range: { zero_through_semitones: 1.8, full_from_semitones: 5 },
        pitch_variation: { zero_through_semitones: 1.1, full_from_semitones: 2.6 },
        non_monotony: {
          flat_window_through_semitones: 0.5,
          full_through_flat_proportion: 0.35,
          zero_at_flat_proportion: 0.9,
        },
        rhythm_cadence: { zero_through_log_spread: 0.03, full_from_log_spread: 0.2 },
      },
    }),
  })

export function validateAudioModeThresholds(value: AudioModeThresholds): boolean {
  const numbers = [
    ...Object.values(value.pace),
    ...Object.values(value.paused_time),
    ...Object.values(value.articulation),
    ...Object.values(value.energy.pitch_range),
    ...Object.values(value.energy.pitch_variation),
    ...Object.values(value.energy.non_monotony),
    ...Object.values(value.energy.rhythm_cadence),
  ]
  if (!numbers.every((item) => Number.isFinite(item) && item >= 0)) return false
  const { pace, paused_time: pause, articulation, energy } = value
  return (
    pace.zero_below_wpm < pace.full_from_wpm &&
    pace.full_from_wpm <= pace.full_through_wpm &&
    pace.full_through_wpm < pace.zero_above_wpm &&
    pause.candidate_gap_ms <= pause.mid_thought_allowance_ms &&
    pause.mid_thought_allowance_ms < pause.natural_boundary_allowance_ms &&
    pause.natural_boundary_allowance_ms < pause.very_long_pause_ms &&
    pause.full_through_ms < pause.zero_at_ms &&
    articulation.low_confidence_below <= 1 &&
    articulation.full_through_low_proportion < articulation.zero_at_low_proportion &&
    articulation.zero_at_low_proportion < articulation.globally_uncertain_at &&
    articulation.globally_uncertain_at <= 1 &&
    energy.pitch_range.zero_through_semitones < energy.pitch_range.full_from_semitones &&
    energy.pitch_variation.zero_through_semitones < energy.pitch_variation.full_from_semitones &&
    energy.non_monotony.full_through_flat_proportion <
      energy.non_monotony.zero_at_flat_proportion &&
    energy.non_monotony.zero_at_flat_proportion <= 1 &&
    energy.rhythm_cadence.zero_through_log_spread < energy.rhythm_cadence.full_from_log_spread
  )
}

for (const mode of Object.keys(AUDIO_THRESHOLDS_BY_MODE) as PracticeMode[]) {
  if (!validateAudioModeThresholds(AUDIO_THRESHOLDS_BY_MODE[mode])) {
    throw new Error(`Invalid audio scoring thresholds for ${mode}.`)
  }
}

export interface AudioMetricEvidence {
  source:
    | 'audio_timeline'
    | 'deepgram_word_confidence'
    | 'energy_flat_window'
    | 'transcript_and_audio_timeline'
  start: number
  end: number
  coordinate: 'audio_millisecond' | 'transcript_utf16'
  quote: string | null
  detail: string
}

export interface AudioMetricDeduction {
  metric: AudioMetricId
  component_reduction: number
  detail: string
}

interface ScoredAudioMetric<Id extends AudioMetricId, Measurements> {
  id: Id
  status: 'scored'
  component: number
  explanation: string
  measurements: Measurements
  evidence: readonly AudioMetricEvidence[]
  deductions: readonly AudioMetricDeduction[]
  warnings: readonly string[]
}

interface UnavailableAudioMetric<Id extends AudioMetricId, Measurements> {
  id: Id
  status: 'unavailable'
  component: null
  explanation: string
  measurements: Measurements
  evidence: readonly []
  deductions: readonly []
  warnings: readonly string[]
}

export type AudioMetricEvaluation<Id extends AudioMetricId, Measurements> =
  ScoredAudioMetric<Id, Measurements> | UnavailableAudioMetric<Id, Measurements>

export interface PaceMeasurements {
  words_per_minute: number | null
  word_count: number
  pace_duration_ms: number | null
  excluded_excessive_pause_ms: number | null
}

export interface PausedTimeMeasurements {
  total_unnatural_pause_ms: number | null
  unnatural_pause_count: number
  total_interword_silence_ms: number | null
  beginning_silence_ms: number | null
  beginning_excessive_pause_ms: number | null
  interword_excessive_pause_ms: number | null
  natural_boundary_excessive_pause_ms: number | null
  mid_thought_excessive_pause_ms: number | null
  very_long_pause_count: number
  transcript_ms: number | null
  amplitude_onset_ms: number | null
  anchored_acoustic_onset_ms: number | null
  selected_onset_ms: number | null
  rms_corroborated: boolean
  source: 'anchored_acoustic' | 'transcript' | null
  origin: 'recording_start'
}

export interface ArticulationMeasurements {
  eligible_word_count: number
  excluded_discourse_word_count: number
  confidence_word_count: number
  confidence_coverage: number | null
  low_confidence_word_count: number
  low_confidence_proportion: number | null
  median_word_confidence: number | null
  speech_to_noise_ratio: number | null
}

export interface EnergyMeasurements {
  pitch_range_semitones: number | null
  pitch_variation_semitones: number | null
  flat_window_proportion: number | null
  cadence_log_spread: number | null
  pitch_range_component: number | null
  pitch_variation_component: number | null
  non_monotony_component: number | null
  rhythm_cadence_component: number | null
  voiced_frame_count: number
  temporal_bin_count: number
  covered_temporal_bin_count: number
  monotony_window_count: number
  flat_window_count: number
  cadence_window_count: number
}

export interface AudioMetricEvaluations {
  pace: AudioMetricEvaluation<'pace', PaceMeasurements>
  paused_time: AudioMetricEvaluation<'paused_time', PausedTimeMeasurements>
  articulation: AudioMetricEvaluation<'articulation', ArticulationMeasurements>
  energy: AudioMetricEvaluation<'energy', EnergyMeasurements>
}

export interface AudioEvaluation {
  version: typeof AUDIO_ANALYSIS_VERSION
  mode: PracticeMode
  metrics: AudioMetricEvaluations
  warnings: readonly string[]
}

export interface AudioEvaluationInput {
  capture: CaptureMetrics | null | undefined
  words: readonly TranscriptWord[]
  transcript: string
  mode: PracticeMode
}

const MIN_PACE_WORDS = 3
const MIN_ARTICULATION_WORDS = 8
const MIN_CONFIDENCE_COVERAGE = 0.8
const MIN_SPEECH_FRAMES = 10
const MIN_SPEECH_LEVEL = 0.002
const MIN_SPEECH_TO_NOISE_RATIO = 2.5
const MAX_EVIDENCE_ITEMS = 8
const MIN_ENERGY_WORDS = 8
const MIN_VOICED_FRAMES = 48
const ENERGY_TEMPORAL_BINS = 4
const MIN_COVERED_ENERGY_BINS = 3
const ENERGY_MONOTONY_WINDOWS = 6
const ENERGY_CADENCE_WORD_WINDOW = 3
const MIN_TIMELINE_DENSITY = 0.7
const MAX_CAPTURE_DURATION_MS = 120_000
const FIRST_WORD_LOOKBACK_MS = 600
const FIRST_WORD_AFTER_ANCHOR_MS = 150
const FIRST_WORD_MAX_ONSET_LEAD_MS = 300
const MIN_ANCHORED_AMPLITUDE_FRAMES = 3
const MIN_ANCHORED_PITCH_FRAMES = 2

interface FirstWordTiming {
  transcript_ms: number
  raw_amplitude_onset_ms: number | null
  anchored_acoustic_onset_ms: number | null
  selected_onset_ms: number
  source: 'anchored_acoustic' | 'transcript'
}

function lowerBetter(value: number, fullThrough: number, zeroAt: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  if (value <= fullThrough) return 1
  return clamp01((zeroAt - value) / (zeroAt - fullThrough))
}

function higherBetter(value: number, zeroThrough: number, fullFrom: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  if (value <= zeroThrough) return 0
  return clamp01((value - zeroThrough) / (fullFrom - zeroThrough))
}

export function paceComponent(wpm: number, mode: PracticeMode): number {
  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].pace
  if (!Number.isFinite(wpm) || wpm <= 0) return 0
  if (wpm >= threshold.full_from_wpm && wpm <= threshold.full_through_wpm) return 1
  if (wpm < threshold.full_from_wpm) {
    return higherBetter(wpm, threshold.zero_below_wpm, threshold.full_from_wpm)
  }
  return lowerBetter(wpm, threshold.full_through_wpm, threshold.zero_above_wpm)
}

/** Depends on total unnatural duration only. Pause count never enters this function. */
export function pausedTimeComponent(totalUnnaturalMs: number, mode: PracticeMode): number {
  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].paused_time
  return lowerBetter(totalUnnaturalMs, threshold.full_through_ms, threshold.zero_at_ms)
}

export function articulationComponent(lowConfidenceProportion: number, mode: PracticeMode): number {
  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].articulation
  return lowerBetter(
    lowConfidenceProportion,
    threshold.full_through_low_proportion,
    threshold.zero_at_low_proportion,
  )
}

/**
 * Pitch Variation and Non-Monotony receive the most weight because robust pitch
 * frames directly support them. Range is down-weighted because it correlates
 * with spread; cadence is down-weighted because word duration also reflects the
 * words spoken even though Deepgram timing itself is reliable.
 */
export const ENERGY_SUBCOMPONENT_WEIGHTS = Object.freeze({
  pitch_range: 0.2,
  pitch_variation: 0.3,
  non_monotony: 0.3,
  rhythm_cadence: 0.2,
})

if (
  Math.abs(
    Object.values(ENERGY_SUBCOMPONENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0) - 1,
  ) > Number.EPSILON
) {
  throw new Error('Energy subcomponent weights must sum to one.')
}

export interface EnergySubcomponents {
  pitch_range: number
  pitch_variation: number
  non_monotony: number
  rhythm_cadence: number
}

export interface EnergyPitchSignals {
  semitone_values: readonly number[]
  pitch_range_semitones: number
  pitch_variation_semitones: number
}

export interface EnergyMonotonySignal {
  window_count: number
  flat_window_count: number
  flat_window_indices: readonly number[]
  flat_window_proportion: number
  component: number
}

export interface EnergyCadenceSignal {
  window_count: number
  cadence_log_spread: number
  component: number
}

function percentile(values: readonly number[], proportion: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((left, right) => left - right)
  const position = clamp01(proportion) * (sorted.length - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex]!
  const upper = sorted[upperIndex]!
  return lower + (upper - lower) * (position - lowerIndex)
}

/**
 * Converts octave-corrected pitch to speaker-relative semitones. The 10th-to-90th
 * percentile span measures the central envelope; scaled MAD measures typical
 * deviation around the median. These are related but not duplicate statistics.
 */
export function energyPitchSignals(hertz: readonly number[]): EnergyPitchSignals | null {
  if (hertz.length === 0 || hertz.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null
  }
  const corrected = correctOctaves(hertz)
  const centre = median(corrected)
  if (!Number.isFinite(centre) || centre <= 0) return null
  const semitoneValues = corrected.map((value) => 12 * Math.log2(value / centre))
  const pitchRange = percentile(semitoneValues, 0.9) - percentile(semitoneValues, 0.1)
  const pitchVariation = medianAbsoluteDeviation(semitoneValues)
  if (
    !Number.isFinite(pitchRange) ||
    pitchRange < 0 ||
    !Number.isFinite(pitchVariation) ||
    pitchVariation < 0
  ) {
    return null
  }
  return {
    semitone_values: semitoneValues,
    pitch_range_semitones: pitchRange,
    pitch_variation_semitones: pitchVariation,
  }
}

export function pitchRangeComponent(rangeSemitones: number, mode: PracticeMode): number {
  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].energy.pitch_range
  return higherBetter(
    rangeSemitones,
    threshold.zero_through_semitones,
    threshold.full_from_semitones,
  )
}

export function pitchVariationComponent(variationSemitones: number, mode: PracticeMode): number {
  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].energy.pitch_variation
  return higherBetter(
    variationSemitones,
    threshold.zero_through_semitones,
    threshold.full_from_semitones,
  )
}

/**
 * Splits voiced active speech into equal-count temporal regions. A region is
 * flat when its local robust spread stays below the mode threshold, so one
 * isolated global jump cannot make an otherwise flat response look varied.
 */
export function energyMonotonySignal(
  semitoneValues: readonly number[],
  mode: PracticeMode,
): EnergyMonotonySignal | null {
  if (
    semitoneValues.length < MIN_VOICED_FRAMES ||
    semitoneValues.some((value) => !Number.isFinite(value))
  ) {
    return null
  }
  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].energy.non_monotony
  const windows = Array.from({ length: ENERGY_MONOTONY_WINDOWS }, (_value, index) => {
    const start = Math.floor((index * semitoneValues.length) / ENERGY_MONOTONY_WINDOWS)
    const end = Math.floor(((index + 1) * semitoneValues.length) / ENERGY_MONOTONY_WINDOWS)
    return semitoneValues.slice(start, end)
  })
  const flatWindowIndices = windows.flatMap((window, index) =>
    medianAbsoluteDeviation(window) <= threshold.flat_window_through_semitones ? [index] : [],
  )
  const flatWindowCount = flatWindowIndices.length
  const flatWindowProportion = flatWindowCount / windows.length
  return {
    window_count: windows.length,
    flat_window_count: flatWindowCount,
    flat_window_indices: flatWindowIndices,
    flat_window_proportion: flatWindowProportion,
    component: lowerBetter(
      flatWindowProportion,
      threshold.full_through_flat_proportion,
      threshold.zero_at_flat_proportion,
    ),
  }
}

/**
 * Measures variation in local active articulation timing. Sliding three-word
 * windows use word durations only, never interword silence, and log-normalizing
 * around the median makes the result invariant to uniformly fast or slow speech.
 */
export function energyCadenceSignal(
  words: readonly TranscriptWord[],
  mode: PracticeMode,
): EnergyCadenceSignal | null {
  if (words.length < MIN_ENERGY_WORDS) return null
  const durations = words.map((word) => (word.end - word.start) * 1_000)
  if (durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) return null
  const localDurations: number[] = []
  for (let index = 0; index <= durations.length - ENERGY_CADENCE_WORD_WINDOW; index += 1) {
    const window = durations.slice(index, index + ENERGY_CADENCE_WORD_WINDOW)
    localDurations.push(window.reduce((sum, duration) => sum + duration, 0) / window.length)
  }
  const centre = median(localDurations)
  if (!Number.isFinite(centre) || centre <= 0) return null
  const relative = localDurations.map((duration) => Math.log2(duration / centre))
  const cadenceLogSpread = medianAbsoluteDeviation(relative)
  if (!Number.isFinite(cadenceLogSpread) || cadenceLogSpread < 0) return null
  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].energy.rhythm_cadence
  return {
    window_count: localDurations.length,
    cadence_log_spread: cadenceLogSpread,
    component: higherBetter(
      cadenceLogSpread,
      threshold.zero_through_log_spread,
      threshold.full_from_log_spread,
    ),
  }
}

/** All four required signals are normalized before this fixed weighted sum. */
export function energyComponent(components: EnergySubcomponents): number | null {
  const entries = Object.entries(ENERGY_SUBCOMPONENT_WEIGHTS) as [
    keyof EnergySubcomponents,
    number,
  ][]
  if (
    entries.some(
      ([key]) => !Number.isFinite(components[key]) || components[key] < 0 || components[key] > 1,
    )
  ) {
    return null
  }
  return clamp01(entries.reduce((sum, [key, weight]) => sum + components[key] * weight, 0))
}

function unavailable<Id extends AudioMetricId, Measurements>(
  id: Id,
  explanation: string,
  measurements: Measurements,
  warning: string,
): UnavailableAudioMetric<Id, Measurements> {
  return {
    id,
    status: 'unavailable',
    component: null,
    explanation,
    measurements,
    evidence: [],
    deductions: [],
    warnings: [warning],
  }
}

function deductions(
  metric: AudioMetricId,
  component: number,
  detail: string,
): readonly AudioMetricDeduction[] {
  return component < 1 ? [{ metric, component_reduction: 1 - component, detail }] : []
}

function energyDeductionDetail(components: EnergySubcomponents): string {
  const pitchWeak = components.pitch_range < 1 || components.pitch_variation < 1
  const flatSectionsWeak = components.non_monotony < 1
  const rhythmWeak = components.rhythm_cadence < 1
  if (pitchWeak && (flatSectionsWeak || rhythmWeak)) {
    return 'Try adding a little more natural variation in your voice and rhythm.'
  }
  if (pitchWeak) return 'Your pitch could vary a little more throughout the response.'
  if (flatSectionsWeak && rhythmWeak) {
    return 'Some parts of your delivery stayed fairly flat, and your speaking rhythm stayed too even.'
  }
  if (flatSectionsWeak) return 'Some parts of your delivery stayed fairly flat.'
  return 'Your speaking rhythm stayed a little too even in parts.'
}

function validDuration(capture: CaptureMetrics): boolean {
  return (
    Number.isFinite(capture.duration_ms) &&
    capture.duration_ms > 0 &&
    capture.duration_ms <= MAX_CAPTURE_DURATION_MS
  )
}

function validWords(words: readonly TranscriptWord[], durationMs: number): boolean {
  let previousStart = -1
  let previousEnd = -1
  for (const word of words) {
    if (
      typeof word.word !== 'string' ||
      word.word.trim().length === 0 ||
      !Number.isFinite(word.start) ||
      !Number.isFinite(word.end) ||
      word.start < 0 ||
      word.end <= word.start ||
      word.start < previousStart ||
      word.end < previousEnd ||
      word.end * 1000 > durationMs
    ) {
      return false
    }
    previousStart = word.start
    previousEnd = word.end
  }
  return true
}

function tokensMatchTranscript(tokens: readonly Token[], transcript: string): boolean {
  return tokens.every((token) => {
    if (
      token.charStart < 0 ||
      token.charEnd <= token.charStart ||
      token.charEnd > transcript.length
    ) {
      return false
    }
    return normalizeWord(transcript.slice(token.charStart, token.charEnd)) === token.word
  })
}

function amplitudeIssue(capture: CaptureMetrics): string | null {
  const { amplitude, duration_ms: durationMs, sample_interval_ms: intervalMs } = capture
  const maximumIntervalMs =
    Math.min(
      ...Object.values(AUDIO_THRESHOLDS_BY_MODE).map((item) => item.paused_time.candidate_gap_ms),
    ) / 2
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > maximumIntervalMs) {
    return 'The amplitude sampling cadence was invalid.'
  }
  if (amplitude.length < 3) return 'The amplitude timeline was missing.'

  let previous = -1
  let largestGap = 0
  for (const sample of amplitude) {
    if (
      !Number.isFinite(sample.t_ms) ||
      sample.t_ms < 0 ||
      sample.t_ms > durationMs ||
      sample.t_ms <= previous ||
      !Number.isFinite(sample.rms) ||
      sample.rms < 0 ||
      sample.rms > 1
    ) {
      return 'The amplitude timeline contained invalid samples.'
    }
    if (previous >= 0) largestGap = Math.max(largestGap, sample.t_ms - previous)
    previous = sample.t_ms
  }

  const first = amplitude[0]!
  const last = amplitude.at(-1)!
  const edgeToleranceMs = Math.max(500, intervalMs * 3)
  const expectedFrames = Math.floor(durationMs / intervalMs)
  if (
    first.t_ms > edgeToleranceMs ||
    durationMs - last.t_ms > edgeToleranceMs ||
    amplitude.length < expectedFrames * MIN_TIMELINE_DENSITY ||
    largestGap > intervalMs * 3
  ) {
    return 'The amplitude timeline was incomplete or interrupted.'
  }
  return null
}

function pitchIssue(capture: CaptureMetrics): string | null {
  let previous = -1
  for (const sample of capture.pitch) {
    if (
      !Number.isFinite(sample.t_ms) ||
      sample.t_ms < 0 ||
      sample.t_ms > capture.duration_ms ||
      sample.t_ms <= previous ||
      !Number.isFinite(sample.hz) ||
      sample.hz < MIN_PITCH_HZ ||
      sample.hz > MAX_PITCH_HZ
    ) {
      return 'The pitch timeline contained invalid samples.'
    }
    previous = sample.t_ms
  }
  return null
}

/**
 * Selects a defensible speech onset without treating an isolated click, breath,
 * or unrelated background sound as the first word. Deepgram supplies the
 * semantic anchor. A nearby sustained RMS run may sharpen that boundary only
 * when voiced pitch corroborates the same run.
 */
function selectFirstWordTiming(
  capture: CaptureMetrics,
  firstWord: TranscriptWord,
  pauseAnalysis: PauseAnalysis | null,
  pitchIsValid: boolean,
): FirstWordTiming {
  const transcriptMs = firstWord.start * 1000
  const rawAmplitudeOnsetMs = pauseAnalysis?.speech_onset_ms ?? null
  if (!pauseAnalysis || !pitchIsValid) {
    return {
      transcript_ms: transcriptMs,
      raw_amplitude_onset_ms: rawAmplitudeOnsetMs,
      anchored_acoustic_onset_ms: null,
      selected_onset_ms: transcriptMs,
      source: 'transcript',
    }
  }

  const intervalMs = capture.sample_interval_ms
  const candidates = capture.amplitude.filter(
    (sample) =>
      sample.t_ms >= Math.max(0, transcriptMs - FIRST_WORD_LOOKBACK_MS) &&
      sample.t_ms <= transcriptMs + FIRST_WORD_AFTER_ANCHOR_MS &&
      sample.rms >= pauseAnalysis.speech_threshold,
  )
  const runs: (typeof candidates)[] = []
  for (const sample of candidates) {
    const current = runs.at(-1)
    const previous = current?.at(-1)
    if (!current || !previous || sample.t_ms - previous.t_ms > intervalMs * 2) {
      runs.push([sample])
    } else {
      current.push(sample)
    }
  }

  const maximumAnchorGapMs = Math.max(100, intervalMs * 2)
  const qualifyingRuns = runs.filter((run) => {
    const first = run[0]
    const last = run.at(-1)
    if (!first || !last) return false
    if (run.length < MIN_ANCHORED_AMPLITUDE_FRAMES) return false
    if (last.t_ms < transcriptMs - maximumAnchorGapMs) return false
    if (first.t_ms < transcriptMs - FIRST_WORD_MAX_ONSET_LEAD_MS) return false
    if (last.t_ms - first.t_ms < intervalMs * 2) return false
    const nearbyPitchFrames = capture.pitch.filter(
      (sample) => sample.t_ms >= first.t_ms - intervalMs && sample.t_ms <= last.t_ms + intervalMs,
    )
    const onsetPitchFrames = nearbyPitchFrames.filter(
      (sample) => sample.t_ms <= first.t_ms + Math.max(150, intervalMs * 3),
    )
    return nearbyPitchFrames.length >= MIN_ANCHORED_PITCH_FRAMES && onsetPitchFrames.length > 0
  })
  const anchoredRun = qualifyingRuns.at(-1)
  const anchoredAcousticOnsetMs = anchoredRun?.[0]?.t_ms ?? null
  const selectedOnsetMs =
    anchoredAcousticOnsetMs === null
      ? transcriptMs
      : Math.min(transcriptMs, anchoredAcousticOnsetMs)

  return {
    transcript_ms: transcriptMs,
    raw_amplitude_onset_ms: rawAmplitudeOnsetMs,
    anchored_acoustic_onset_ms: anchoredAcousticOnsetMs,
    selected_onset_ms: selectedOnsetMs,
    source: anchoredAcousticOnsetMs === null ? 'transcript' : 'anchored_acoustic',
  }
}

function lowConfidence(value: TranscriptWord, threshold: number): boolean {
  return typeof value.confidence === 'number' && value.confidence < threshold
}

function confidence(value: TranscriptWord): number | null {
  return typeof value.confidence === 'number' &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1
    ? value.confidence
    : null
}

function prepare(input: AudioEvaluationInput): {
  capture: CaptureMetrics | null
  durationIssue: string | null
  wordsIssue: string | null
  transcriptIssue: string | null
  amplitudeIssue: string | null
  pitchIssue: string | null
  tokens: Token[]
  excludedDiscourseIndices: ReadonlySet<number>
  pauseAnalysis: PauseAnalysis | null
  firstWordTiming: FirstWordTiming | null
} {
  const capture = input.capture ?? null
  if (!capture || !validDuration(capture)) {
    return {
      capture,
      durationIssue: 'The recording duration was missing or invalid.',
      wordsIssue: null,
      transcriptIssue: null,
      amplitudeIssue: null,
      pitchIssue: null,
      tokens: [],
      excludedDiscourseIndices: new Set(),
      pauseAnalysis: null,
      firstWordTiming: null,
    }
  }

  const wordsIssue =
    input.words.length === 0 || !validWords(input.words, capture.duration_ms)
      ? 'The final transcript word timings were missing or invalid.'
      : null
  const tokens = wordsIssue ? [] : buildTokens(input.words, input.transcript)
  const transcriptIssue =
    input.transcript.trim().length === 0 ||
    tokens.length !== input.words.length ||
    !tokensMatchTranscript(tokens, input.transcript)
      ? 'The transcript text did not match its timed words.'
      : null
  const levelIssue = amplitudeIssue(capture)
  const frequencyIssue = pitchIssue(capture)
  const fillers = transcriptIssue ? null : analyseFillers(tokens, tokens.length)
  const excludedDiscourseIndices = new Set(fillers?.hits.flatMap((hit) => hit.token_indices) ?? [])
  const fillerIndices = new Set(
    fillers?.hits.filter((hit) => hit.category === 'filler').flatMap((hit) => hit.token_indices) ??
      [],
  )
  const pauseAnalysis =
    !wordsIssue && !transcriptIssue && !levelIssue
      ? analysePauses(capture.amplitude, input.words, capture.duration_ms, fillerIndices)
      : null
  const firstWordTiming =
    !wordsIssue && !transcriptIssue && input.words[0]
      ? selectFirstWordTiming(capture, input.words[0], pauseAnalysis, frequencyIssue === null)
      : null

  return {
    capture,
    durationIssue: null,
    wordsIssue,
    transcriptIssue,
    amplitudeIssue: levelIssue,
    pitchIssue: frequencyIssue,
    tokens,
    excludedDiscourseIndices,
    pauseAnalysis,
    firstWordTiming,
  }
}

type Prepared = ReturnType<typeof prepare>

function prepareIssue(prepared: Prepared, needsAmplitude: boolean): string | null {
  return (
    prepared.durationIssue ??
    prepared.wordsIssue ??
    prepared.transcriptIssue ??
    (needsAmplitude ? prepared.amplitudeIssue : null)
  )
}

function evaluatePace(prepared: Prepared, mode: PracticeMode): AudioMetricEvaluations['pace'] {
  const issue = prepareIssue(prepared, true)
  const wordCount = prepared.tokens.length
  const empty: PaceMeasurements = {
    words_per_minute: null,
    word_count: wordCount,
    pace_duration_ms: null,
    excluded_excessive_pause_ms: null,
  }
  if (issue || !prepared.capture || !prepared.pauseAnalysis || wordCount < MIN_PACE_WORDS) {
    const reason = issue ?? `At least ${MIN_PACE_WORDS} timed words are required.`
    return unavailable(
      'pace',
      'Your pace could not be measured from this recording.',
      empty,
      reason,
    )
  }

  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].paused_time
  const excludedExcessivePauseMs = prepared.pauseAnalysis.pauses.reduce((total, pause) => {
    const charged = excessivePause(pause, tokenBeforePause(prepared.tokens, pause), threshold)
    return total + (charged?.excessive_ms ?? 0)
  }, 0)
  const responseStartMs =
    prepared.firstWordTiming?.selected_onset_ms ?? prepared.pauseAnalysis.leading_silence_ms
  const responseEndMs = prepared.tokens.at(-1)!.end * 1_000
  const paceDurationMs = responseEndMs - responseStartMs - excludedExcessivePauseMs
  const wpm = wordCount / (paceDurationMs / 60_000)
  if (
    !Number.isFinite(excludedExcessivePauseMs) ||
    excludedExcessivePauseMs < 0 ||
    !Number.isFinite(paceDurationMs) ||
    paceDurationMs <= 0 ||
    paceDurationMs > prepared.capture.duration_ms ||
    !Number.isFinite(wpm) ||
    wpm <= 0
  ) {
    return unavailable(
      'pace',
      'Your pace could not be measured from this recording.',
      empty,
      'The Pace duration was invalid.',
    )
  }

  const component = paceComponent(wpm, mode)
  const measurement: PaceMeasurements = {
    words_per_minute: wpm,
    word_count: wordCount,
    pace_duration_ms: paceDurationMs,
    excluded_excessive_pause_ms: excludedExcessivePauseMs,
  }
  const roundedWpm = Math.round(wpm)
  return {
    id: 'pace',
    status: 'scored',
    component,
    explanation: `You spoke at ${roundedWpm} words per minute across your response.`,
    measurements: measurement,
    evidence: [
      {
        source: 'transcript_and_audio_timeline',
        start: 0,
        end: prepared.capture.duration_ms,
        coordinate: 'audio_millisecond',
        quote: null,
        detail: `${wordCount} words over ${(paceDurationMs / 1000).toFixed(1)} seconds, with ${(excludedExcessivePauseMs / 1_000).toFixed(1)} seconds of excessive hesitation excluded.`,
      },
    ],
    deductions: deductions('pace', component, `${roundedWpm} words per minute.`),
    warnings: prepared.pauseAnalysis.warnings,
  }
}

type PauseContext = 'mid_thought' | 'natural_boundary'

interface ExcessivePause {
  pause: Pause
  context: PauseContext
  allowance_ms: number
  excessive_ms: number
  very_long: boolean
}

function excessivePause(
  pause: Pause,
  before: Token | undefined,
  threshold: AudioModeThresholds['paused_time'],
): ExcessivePause | null {
  const naturalBoundary =
    !pause.after_filler && Boolean(before?.endsSentence) && !FUNCTION_WORDS.has(before?.word ?? '')
  const context: PauseContext = naturalBoundary ? 'natural_boundary' : 'mid_thought'
  const allowanceMs = naturalBoundary
    ? threshold.natural_boundary_allowance_ms
    : threshold.mid_thought_allowance_ms
  const excessiveMs = Math.max(0, pause.duration_ms - allowanceMs)
  return excessiveMs > 0
    ? {
        pause,
        context,
        allowance_ms: allowanceMs,
        excessive_ms: excessiveMs,
        very_long: pause.duration_ms >= threshold.very_long_pause_ms,
      }
    : null
}

function tokenBeforePause(tokens: readonly Token[], pause: Pause): Token | undefined {
  let nearest: Token | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const token of tokens) {
    const distance = Math.abs(token.end * 1000 - pause.start_ms)
    if (distance < nearestDistance) {
      nearest = token
      nearestDistance = distance
    }
  }
  return nearest
}

function evaluatePausedTime(
  prepared: Prepared,
  mode: PracticeMode,
): AudioMetricEvaluations['paused_time'] {
  const issue = prepareIssue(prepared, true)
  const empty: PausedTimeMeasurements = {
    total_unnatural_pause_ms: null,
    unnatural_pause_count: 0,
    total_interword_silence_ms: null,
    beginning_silence_ms: null,
    beginning_excessive_pause_ms: null,
    interword_excessive_pause_ms: null,
    natural_boundary_excessive_pause_ms: null,
    mid_thought_excessive_pause_ms: null,
    very_long_pause_count: 0,
    transcript_ms: null,
    amplitude_onset_ms: null,
    anchored_acoustic_onset_ms: null,
    selected_onset_ms: null,
    rms_corroborated: false,
    source: null,
    origin: 'recording_start',
  }
  const timing = prepared.firstWordTiming
  const firstWord = prepared.tokens[0]
  if (issue || !prepared.pauseAnalysis || !timing || !firstWord) {
    return unavailable(
      'paused_time',
      'Your paused time could not be measured from this recording.',
      empty,
      issue ?? 'Speech onset or interword pause evidence was unavailable.',
    )
  }

  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].paused_time
  const beginningSilenceMs = timing.selected_onset_ms
  const beginningExcessiveMs = Math.max(
    0,
    beginningSilenceMs - threshold.natural_boundary_allowance_ms,
  )
  const excessiveInterword = prepared.pauseAnalysis.pauses.flatMap((pause) => {
    const charged = excessivePause(pause, tokenBeforePause(prepared.tokens, pause), threshold)
    return charged ? [charged] : []
  })
  const interwordExcessiveMs = excessiveInterword.reduce((sum, item) => sum + item.excessive_ms, 0)
  const naturalBoundaryExcessiveMs = excessiveInterword
    .filter((item) => item.context === 'natural_boundary')
    .reduce((sum, item) => sum + item.excessive_ms, 0)
  const midThoughtExcessiveMs = excessiveInterword
    .filter((item) => item.context === 'mid_thought')
    .reduce((sum, item) => sum + item.excessive_ms, 0)
  const beginningVeryLong = beginningSilenceMs >= threshold.very_long_pause_ms
  const veryLongPauseCount =
    excessiveInterword.filter((item) => item.very_long).length + (beginningVeryLong ? 1 : 0)
  const totalUnnaturalMs = beginningExcessiveMs + interwordExcessiveMs
  const totalInterwordMs = prepared.pauseAnalysis.pauses.reduce(
    (sum, pause) => sum + pause.duration_ms,
    0,
  )
  if (!Number.isFinite(totalUnnaturalMs) || totalUnnaturalMs < 0) {
    return unavailable(
      'paused_time',
      'Your paused time could not be measured from this recording.',
      empty,
      'The total unnatural pause duration was invalid.',
    )
  }

  const component = pausedTimeComponent(totalUnnaturalMs, mode)
  const initialEvidence: AudioMetricEvidence[] =
    beginningExcessiveMs > 0
      ? [
          {
            source: 'transcript_and_audio_timeline',
            start: threshold.natural_boundary_allowance_ms,
            end: beginningSilenceMs,
            coordinate: 'audio_millisecond',
            quote: firstWord.raw,
            detail: `${(beginningExcessiveMs / 1000).toFixed(1)} seconds of ${beginningVeryLong ? 'very long ' : ''}excessive beginning hesitation after ${(threshold.natural_boundary_allowance_ms / 1000).toFixed(1)} seconds of natural leeway.`,
          },
        ]
      : []
  const interwordEvidence = excessiveInterword.map((item): AudioMetricEvidence => {
    const context = item.context === 'natural_boundary' ? 'natural-boundary' : 'mid-thought'
    const prefix = item.very_long
      ? `This very long ${context} pause had`
      : `This ${context} pause had`
    return {
      source: 'audio_timeline',
      start: item.pause.end_ms - item.excessive_ms,
      end: item.pause.end_ms,
      coordinate: 'audio_millisecond',
      quote: item.pause.preceding_word,
      detail: `${prefix} ${(item.excessive_ms / 1000).toFixed(1)} seconds beyond ${(item.allowance_ms / 1000).toFixed(1)} seconds of natural leeway.`,
    }
  })
  const evidence = [...initialEvidence, ...interwordEvidence]
  const warnings = [...prepared.pauseAnalysis.warnings]
  if (prepared.pitchIssue) warnings.push(`Voiced onset was unavailable. ${prepared.pitchIssue}`)
  if (evidence.length > MAX_EVIDENCE_ITEMS) {
    warnings.push(`Pause evidence was limited to ${MAX_EVIDENCE_ITEMS} items.`)
  }
  return {
    id: 'paused_time',
    status: 'scored',
    component,
    explanation: `You had ${(totalUnnaturalMs / 1000).toFixed(1)} seconds of excessive paused time.`,
    measurements: {
      total_unnatural_pause_ms: totalUnnaturalMs,
      unnatural_pause_count: excessiveInterword.length + (beginningExcessiveMs > 0 ? 1 : 0),
      total_interword_silence_ms: totalInterwordMs,
      beginning_silence_ms: beginningSilenceMs,
      beginning_excessive_pause_ms: beginningExcessiveMs,
      interword_excessive_pause_ms: interwordExcessiveMs,
      natural_boundary_excessive_pause_ms: naturalBoundaryExcessiveMs,
      mid_thought_excessive_pause_ms: midThoughtExcessiveMs,
      very_long_pause_count: veryLongPauseCount,
      transcript_ms: timing.transcript_ms,
      amplitude_onset_ms: timing.raw_amplitude_onset_ms,
      anchored_acoustic_onset_ms: timing.anchored_acoustic_onset_ms,
      selected_onset_ms: timing.selected_onset_ms,
      rms_corroborated: timing.anchored_acoustic_onset_ms !== null,
      source: timing.source,
      origin: 'recording_start',
    },
    evidence: evidence.slice(0, MAX_EVIDENCE_ITEMS),
    deductions: deductions(
      'paused_time',
      component,
      `${(totalUnnaturalMs / 1000).toFixed(1)} total seconds of excessive paused time.`,
    ),
    warnings,
  }
}

function lowerDecile(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.1)))
}

function evaluateArticulation(
  prepared: Prepared,
  words: readonly TranscriptWord[],
  mode: PracticeMode,
): AudioMetricEvaluations['articulation'] {
  const issue = prepareIssue(prepared, true)
  const eligible = words.filter((_word, index) => !prepared.excludedDiscourseIndices.has(index))
  const confidenceWords = eligible.filter((word) => confidence(word) !== null)
  const confidenceCoverage = eligible.length > 0 ? confidenceWords.length / eligible.length : null
  const base: ArticulationMeasurements = {
    eligible_word_count: eligible.length,
    excluded_discourse_word_count: words.length - eligible.length,
    confidence_word_count: confidenceWords.length,
    confidence_coverage: confidenceCoverage,
    low_confidence_word_count: 0,
    low_confidence_proportion: null,
    median_word_confidence: null,
    speech_to_noise_ratio: null,
  }
  if (issue || !prepared.capture || eligible.length < MIN_ARTICULATION_WORDS) {
    const reason = issue ?? `At least ${MIN_ARTICULATION_WORDS} eligible timed words are required.`
    return unavailable(
      'articulation',
      'Your articulation could not be measured from this recording.',
      base,
      reason,
    )
  }
  if (confidenceCoverage === null || confidenceCoverage < MIN_CONFIDENCE_COVERAGE) {
    return unavailable(
      'articulation',
      'Your articulation could not be measured from this recording.',
      base,
      'Final word confidence coverage was incomplete.',
    )
  }

  const allWordWindows = words.map((word) => ({ start: word.start * 1000, end: word.end * 1000 }))
  const eligibleWindows = eligible.map((word) => ({
    start: word.start * 1000,
    end: word.end * 1000,
  }))
  const speechFrames = prepared.capture.amplitude
    .filter((sample) =>
      eligibleWindows.some((window) => sample.t_ms >= window.start && sample.t_ms <= window.end),
    )
    .map((sample) => sample.rms)
  const outsideSpeech = prepared.capture.amplitude
    .filter(
      (sample) =>
        !allWordWindows.some((window) => sample.t_ms >= window.start && sample.t_ms <= window.end),
    )
    .map((sample) => sample.rms)
  if (speechFrames.length < MIN_SPEECH_FRAMES) {
    return unavailable(
      'articulation',
      'Your articulation could not be measured from this recording.',
      base,
      'Too little eligible recognized-word audio was available.',
    )
  }

  const speechLevel = median(speechFrames)
  // Gate confidence scoring on actual recognized-word signal. This prevents a
  // noisy or near-silent recording from turning provider uncertainty into a score.
  const noiseLevel = median(
    outsideSpeech.length >= MIN_SPEECH_FRAMES
      ? outsideSpeech
      : lowerDecile(prepared.capture.amplitude.map((sample) => sample.rms)),
  )
  const signalRatio = speechLevel / Math.max(noiseLevel, Number.EPSILON)
  const withSignal: ArticulationMeasurements = { ...base, speech_to_noise_ratio: signalRatio }
  if (
    !Number.isFinite(speechLevel) ||
    !Number.isFinite(noiseLevel) ||
    !Number.isFinite(signalRatio) ||
    speechLevel < MIN_SPEECH_LEVEL ||
    signalRatio < MIN_SPEECH_TO_NOISE_RATIO
  ) {
    return unavailable(
      'articulation',
      'Your articulation could not be measured from this recording.',
      withSignal,
      'Recognized speech did not separate reliably from surrounding audio.',
    )
  }

  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].articulation
  const lowWords = confidenceWords.filter((word) =>
    lowConfidence(word, threshold.low_confidence_below),
  )
  const lowProportion = lowWords.length / confidenceWords.length
  const confidenceValues = confidenceWords.map((word) => confidence(word) as number)
  const measurements: ArticulationMeasurements = {
    ...withSignal,
    low_confidence_word_count: lowWords.length,
    low_confidence_proportion: lowProportion,
    median_word_confidence: median(confidenceValues),
  }
  if (lowProportion >= threshold.globally_uncertain_at) {
    return unavailable(
      'articulation',
      'Your articulation could not be measured reliably from this recording.',
      measurements,
      'Final word recognition was globally uncertain.',
    )
  }

  const component = articulationComponent(lowProportion, mode)
  const evidence: AudioMetricEvidence[] = lowWords.slice(0, MAX_EVIDENCE_ITEMS).flatMap((word) => {
    const index = words.indexOf(word)
    const token = prepared.tokens[index]
    return token
      ? [
          {
            source: 'deepgram_word_confidence' as const,
            start: token.charStart,
            end: token.charEnd,
            coordinate: 'transcript_utf16' as const,
            quote: prepared.tokens[index]?.raw ?? word.word,
            detail: `Final recognition confidence was ${(confidence(word) ?? 0).toFixed(2)}.`,
          },
        ]
      : []
  })
  evidence.push({
    source: 'transcript_and_audio_timeline',
    start: 0,
    end: prepared.capture.duration_ms,
    coordinate: 'audio_millisecond',
    quote: null,
    detail: `Eligible speech was ${signalRatio.toFixed(1)} times the surrounding audio level.`,
  })
  return {
    id: 'articulation',
    status: 'scored',
    component,
    explanation:
      lowWords.length === 0
        ? 'Your eligible spoken words were transcribed consistently.'
        : `${lowWords.length} eligible spoken ${lowWords.length === 1 ? 'word had' : 'words had'} lower recognition confidence.`,
    measurements,
    evidence,
    deductions: deductions(
      'articulation',
      component,
      `${(lowProportion * 100).toFixed(0)} percent of eligible words had lower recognition confidence.`,
    ),
    warnings:
      lowWords.length > MAX_EVIDENCE_ITEMS
        ? [`Articulation evidence was limited to ${MAX_EVIDENCE_ITEMS} words.`]
        : [],
  }
}

function evaluateEnergy(
  prepared: Prepared,
  words: readonly TranscriptWord[],
  mode: PracticeMode,
): AudioMetricEvaluations['energy'] {
  const issue = prepareIssue(prepared, false) ?? prepared.pitchIssue
  const empty: EnergyMeasurements = {
    pitch_range_semitones: null,
    pitch_variation_semitones: null,
    flat_window_proportion: null,
    cadence_log_spread: null,
    pitch_range_component: null,
    pitch_variation_component: null,
    non_monotony_component: null,
    rhythm_cadence_component: null,
    voiced_frame_count: 0,
    temporal_bin_count: ENERGY_TEMPORAL_BINS,
    covered_temporal_bin_count: 0,
    monotony_window_count: ENERGY_MONOTONY_WINDOWS,
    flat_window_count: 0,
    cadence_window_count: 0,
  }
  if (issue || !prepared.capture || words.length < MIN_ENERGY_WORDS) {
    const reason = issue ?? `At least ${MIN_ENERGY_WORDS} timed words are required.`
    return unavailable(
      'energy',
      'Your vocal variation could not be measured from this recording.',
      empty,
      reason,
    )
  }

  const activePitch = prepared.capture.pitch.filter((sample) =>
    words.some((word) => sample.t_ms >= word.start * 1000 && sample.t_ms <= word.end * 1000),
  )
  const coveredBins = new Set<number>()
  for (const sample of activePitch) {
    const wordIndex = words.findIndex(
      (word) => sample.t_ms >= word.start * 1_000 && sample.t_ms <= word.end * 1_000,
    )
    if (wordIndex >= 0) {
      coveredBins.add(
        Math.min(
          ENERGY_TEMPORAL_BINS - 1,
          Math.floor((wordIndex / words.length) * ENERGY_TEMPORAL_BINS),
        ),
      )
    }
  }
  const base: EnergyMeasurements = {
    ...empty,
    voiced_frame_count: activePitch.length,
    covered_temporal_bin_count: coveredBins.size,
  }
  if (activePitch.length < MIN_VOICED_FRAMES || coveredBins.size < MIN_COVERED_ENERGY_BINS) {
    return unavailable(
      'energy',
      'Your vocal variation could not be measured from this recording.',
      base,
      'Voiced pitch evidence was insufficient or too concentrated in time.',
    )
  }

  const pitch = energyPitchSignals(activePitch.map((sample) => sample.hz))
  const monotony = pitch ? energyMonotonySignal(pitch.semitone_values, mode) : null
  const cadence = energyCadenceSignal(words, mode)
  if (!pitch || !monotony || !cadence) {
    return unavailable(
      'energy',
      'Your vocal variation could not be measured from this recording.',
      base,
      'One or more required vocal-variation signals were invalid.',
    )
  }

  const components: EnergySubcomponents = {
    pitch_range: pitchRangeComponent(pitch.pitch_range_semitones, mode),
    pitch_variation: pitchVariationComponent(pitch.pitch_variation_semitones, mode),
    non_monotony: monotony.component,
    rhythm_cadence: cadence.component,
  }
  const component = energyComponent(components)
  if (component === null) {
    return unavailable(
      'energy',
      'Your vocal variation could not be measured from this recording.',
      base,
      'The combined vocal-variation score was invalid.',
    )
  }
  const measurements: EnergyMeasurements = {
    ...base,
    pitch_range_semitones: pitch.pitch_range_semitones,
    pitch_variation_semitones: pitch.pitch_variation_semitones,
    flat_window_proportion: monotony.flat_window_proportion,
    cadence_log_spread: cadence.cadence_log_spread,
    pitch_range_component: components.pitch_range,
    pitch_variation_component: components.pitch_variation,
    non_monotony_component: components.non_monotony,
    rhythm_cadence_component: components.rhythm_cadence,
    monotony_window_count: monotony.window_count,
    flat_window_count: monotony.flat_window_count,
    cadence_window_count: cadence.window_count,
  }
  const pitchStrong = (components.pitch_range + components.pitch_variation) / 2 >= 0.65
  const temporalStrong = (components.non_monotony + components.rhythm_cadence) / 2 >= 0.65
  const broadlyVaried = Object.values(components).every((value) => value >= 0.6)
  const explanation =
    component >= 0.8 && broadlyVaried
      ? 'You used natural variation in pitch and rhythm throughout most of your response.'
      : pitchStrong && !temporalStrong
        ? 'Your pitch varied, but parts of your response stayed fairly flat or even in rhythm.'
        : !pitchStrong && temporalStrong
          ? 'Your rhythm varied, but your voice stayed fairly flat through much of your response.'
          : component >= 0.45
            ? 'Your voice had some natural variation, with a few flatter or more even stretches.'
            : 'Your voice stayed fairly flat and even through much of your response.'
  const flatWindowEvidence: AudioMetricEvidence[] =
    monotony.component < 1
      ? monotony.flat_window_indices.flatMap((windowIndex) => {
          const startIndex = Math.floor((windowIndex * activePitch.length) / monotony.window_count)
          const endIndex =
            Math.floor(((windowIndex + 1) * activePitch.length) / monotony.window_count) - 1
          const start = activePitch[startIndex]?.t_ms
          const end = activePitch[endIndex]?.t_ms
          return start !== undefined && end !== undefined && end > start
            ? [
                {
                  source: 'energy_flat_window' as const,
                  start,
                  end,
                  coordinate: 'audio_millisecond' as const,
                  quote: null,
                  detail: 'Your voice stayed fairly flat through this section.',
                },
              ]
            : []
        })
      : []
  return {
    id: 'energy',
    status: 'scored',
    component,
    explanation,
    measurements,
    evidence: [
      {
        source: 'audio_timeline',
        start: activePitch[0]!.t_ms,
        end: activePitch.at(-1)!.t_ms,
        coordinate: 'audio_millisecond',
        quote: null,
        detail: `Your response used a ${pitch.pitch_range_semitones.toFixed(1)}-semitone central pitch range, ${(monotony.flat_window_proportion * 100).toFixed(0)} percent flatter vocal sections, and ${cadence.component >= 0.65 ? 'varied' : 'fairly even'} speaking rhythm.`,
      },
      ...flatWindowEvidence,
    ],
    deductions: deductions('energy', component, energyDeductionDetail(components)),
    warnings: [],
  }
}

/**
 * Scores four visible audio metrics from persisted recording evidence. No LLM,
 * Azure output, accent label, or volume-consistency dimension enters the score.
 */
export function evaluateAudioMetrics(input: AudioEvaluationInput): AudioEvaluation {
  const prepared = prepare(input)
  const metrics: AudioMetricEvaluations = {
    pace: evaluatePace(prepared, input.mode),
    paused_time: evaluatePausedTime(prepared, input.mode),
    articulation: evaluateArticulation(prepared, input.words, input.mode),
    energy: evaluateEnergy(prepared, input.words, input.mode),
  }
  return {
    version: AUDIO_ANALYSIS_VERSION,
    mode: input.mode,
    metrics,
    warnings: Object.values(metrics).flatMap((metric) => metric.warnings),
  }
}
