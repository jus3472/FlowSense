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

export const AUDIO_ANALYSIS_VERSION = 'v3.audio.2' as const

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
    readonly zero_through_semitones: number
    readonly full_from_semitones: number
  }
}

function frozenThresholds(value: AudioModeThresholds): AudioModeThresholds {
  return Object.freeze({
    pace: Object.freeze(value.pace),
    paused_time: Object.freeze(value.paused_time),
    articulation: Object.freeze(value.articulation),
    energy: Object.freeze(value.energy),
  })
}

/**
 * Mode-specific measurement thresholds. Metric weights live in the scoring definition.
 * Each component is piecewise linear between named anchors so product tuning remains
 * explicit: pace has a natural band, paused time totals only silence beyond contextual
 * allowances, confidence is a low-word proportion, and energy is robust pitch spread.
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
      energy: { zero_through_semitones: 1.2, full_from_semitones: 2.8 },
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
      energy: { zero_through_semitones: 1.2, full_from_semitones: 2.8 },
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
      energy: { zero_through_semitones: 1.4, full_from_semitones: 3 },
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
      energy: { zero_through_semitones: 1.1, full_from_semitones: 2.6 },
    }),
  })

export function validateAudioModeThresholds(value: AudioModeThresholds): boolean {
  const numbers = [
    ...Object.values(value.pace),
    ...Object.values(value.paused_time),
    ...Object.values(value.articulation),
    ...Object.values(value.energy),
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
    energy.zero_through_semitones < energy.full_from_semitones
  )
}

for (const mode of Object.keys(AUDIO_THRESHOLDS_BY_MODE) as PracticeMode[]) {
  if (!validateAudioModeThresholds(AUDIO_THRESHOLDS_BY_MODE[mode])) {
    throw new Error(`Invalid audio scoring thresholds for ${mode}.`)
  }
}

export function audioThresholdsFor(mode: PracticeMode): AudioModeThresholds {
  return AUDIO_THRESHOLDS_BY_MODE[mode]
}

export interface AudioMetricEvidence {
  source: 'audio_timeline' | 'deepgram_word_confidence' | 'transcript_and_audio_timeline'
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
  active_speaking_ms: number | null
  excluded_silence_ms: number | null
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
  pitch_spread_semitones: number | null
  voiced_frame_count: number
  temporal_bin_count: number
  covered_temporal_bin_count: number
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
const MIN_ENERGY_WORDS = 3
const MIN_VOICED_FRAMES = 40
const ENERGY_TEMPORAL_BINS = 3
const MIN_COVERED_ENERGY_BINS = 2
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

export function energyComponent(spreadSemitones: number, mode: PracticeMode): number {
  const threshold = AUDIO_THRESHOLDS_BY_MODE[mode].energy
  return higherBetter(
    spreadSemitones,
    threshold.zero_through_semitones,
    threshold.full_from_semitones,
  )
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
    active_speaking_ms: null,
    excluded_silence_ms: null,
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

  const correctedLeadingSilenceMs =
    prepared.firstWordTiming?.selected_onset_ms ?? prepared.pauseAnalysis.leading_silence_ms
  const excludedSilenceMs =
    prepared.pauseAnalysis.total_silence_ms -
    prepared.pauseAnalysis.leading_silence_ms +
    correctedLeadingSilenceMs
  const activeSpeakingMs = prepared.capture.duration_ms - excludedSilenceMs
  const wpm = wordCount / (activeSpeakingMs / 60_000)
  if (
    !Number.isFinite(excludedSilenceMs) ||
    excludedSilenceMs < 0 ||
    !Number.isFinite(activeSpeakingMs) ||
    activeSpeakingMs <= 0 ||
    activeSpeakingMs > prepared.capture.duration_ms ||
    !Number.isFinite(wpm) ||
    wpm <= 0
  ) {
    return unavailable(
      'pace',
      'Your pace could not be measured from this recording.',
      empty,
      'The active speaking duration was invalid.',
    )
  }

  const component = paceComponent(wpm, mode)
  const measurement: PaceMeasurements = {
    words_per_minute: wpm,
    word_count: wordCount,
    active_speaking_ms: activeSpeakingMs,
    excluded_silence_ms: excludedSilenceMs,
  }
  const roundedWpm = Math.round(wpm)
  return {
    id: 'pace',
    status: 'scored',
    component,
    explanation: `You spoke at ${roundedWpm} words per minute during active speech.`,
    measurements: measurement,
    evidence: [
      {
        source: 'transcript_and_audio_timeline',
        start: 0,
        end: prepared.capture.duration_ms,
        coordinate: 'audio_millisecond',
        quote: null,
        detail: `${wordCount} words over ${(activeSpeakingMs / 1000).toFixed(1)} seconds of active speech.`,
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
    pitch_spread_semitones: null,
    voiced_frame_count: 0,
    temporal_bin_count: ENERGY_TEMPORAL_BINS,
    covered_temporal_bin_count: 0,
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
  const firstMs = words[0]!.start * 1000
  const lastMs = words.at(-1)!.end * 1000
  const spanMs = lastMs - firstMs
  const coveredBins = new Set<number>()
  if (spanMs > 0) {
    for (const sample of activePitch) {
      coveredBins.add(
        Math.min(
          ENERGY_TEMPORAL_BINS - 1,
          Math.floor(((sample.t_ms - firstMs) / spanMs) * ENERGY_TEMPORAL_BINS),
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

  // The v2 correction is a pure signal helper. MAD then limits the effect of
  // detector outliers without introducing loudness or an accent reference.
  const corrected = correctOctaves(activePitch.map((sample) => sample.hz))
  const centre = median(corrected)
  const semitoneValues = corrected.map((hz) => 12 * Math.log2(hz / centre))
  const spread = medianAbsoluteDeviation(semitoneValues)
  if (!Number.isFinite(spread) || spread < 0) {
    return unavailable(
      'energy',
      'Your vocal variation could not be measured from this recording.',
      base,
      'Pitch variation produced an invalid measurement.',
    )
  }

  const component = energyComponent(spread, mode)
  return {
    id: 'energy',
    status: 'scored',
    component,
    explanation: `Your pitch varied by ${spread.toFixed(2)} semitones during recognized speech.`,
    measurements: { ...base, pitch_spread_semitones: spread },
    evidence: [
      {
        source: 'audio_timeline',
        start: activePitch[0]!.t_ms,
        end: activePitch.at(-1)!.t_ms,
        coordinate: 'audio_millisecond',
        quote: null,
        detail: `${spread.toFixed(2)} semitones across ${activePitch.length} voiced frames in recognized speech.`,
      },
    ],
    deductions: deductions(
      'energy',
      component,
      `${spread.toFixed(2)} semitones of pitch variation.`,
    ),
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
