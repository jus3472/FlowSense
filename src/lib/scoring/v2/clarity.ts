import type { TranscriptWord } from '@/lib/deepgram/parse'
import { clamp01, median } from '@/lib/scoring/scale'
import type { ScoreEvidence } from '@/lib/scoring/v2/contracts'
import type { CaptureMetrics } from '@/lib/types/metrics'
import { parsePronunciationEvaluation } from '@/lib/pronunciation/contracts'

export const LOW_WORD_CONFIDENCE = 0.75
export const MIN_CLARITY_WORDS = 8
export const MIN_CONFIDENCE_COVERAGE = 0.8
export const GLOBAL_UNCERTAINTY_PROPORTION = 0.6

const MAX_SAMPLE_INTERVAL_MS = 250
const MIN_CAPTURE_DENSITY = 0.7
const MIN_SPEECH_SAMPLES = 10
const MIN_SPEECH_LEVEL = 0.002
const MIN_SPEECH_TO_NOISE_RATIO = 2.5
const MAX_WORD_EVIDENCE = 8

export interface ClarityMeasurements {
  word_count: number
  confidence_word_count: number
  confidence_coverage: number
  low_confidence_count: number
  low_confidence_proportion: number | null
  median_word_confidence: number | null
  amplitude_frame_count: number
  speech_level: number | null
  noise_level: number | null
  speech_to_noise_ratio: number | null
  pronunciation_status: 'missing' | 'completed' | 'not_checked' | 'failed' | 'malformed'
  pronunciation_assessed_word_count: number
  pronunciation_matched_word_count: number
  pronunciation_phoneme_evidence_count: number
}

export interface ClarityDeduction {
  id: 'recognition_uncertainty'
  component_reduction: number
  detail: string
}

export interface ClarityResult {
  category: 'clarity'
  availability: 'available' | 'unavailable'
  status: 'scored' | 'not_checked' | 'unavailable'
  component: number | null
  measurements: ClarityMeasurements
  evidence: readonly ScoreEvidence[]
  deductions: readonly ClarityDeduction[]
  warnings: readonly string[]
}

interface AudioEvidence {
  speechLevel: number
  noiseLevel: number
  speechToNoiseRatio: number
}

type CaptureCheck =
  | { status: 'available'; audio: AudioEvidence }
  | { status: 'not_checked'; warning: string }
  | { status: 'unavailable'; warning: string }

function baseMeasurements(
  words: readonly TranscriptWord[],
  capture?: CaptureMetrics | null,
): ClarityMeasurements {
  return {
    word_count: words.length,
    confidence_word_count: 0,
    confidence_coverage: 0,
    low_confidence_count: 0,
    low_confidence_proportion: null,
    median_word_confidence: null,
    amplitude_frame_count: capture?.amplitude.length ?? 0,
    speech_level: null,
    noise_level: null,
    speech_to_noise_ratio: null,
    pronunciation_status: 'missing',
    pronunciation_assessed_word_count: 0,
    pronunciation_matched_word_count: 0,
    pronunciation_phoneme_evidence_count: 0,
  }
}

function unavailable(measurements: ClarityMeasurements, warning: string): ClarityResult {
  return {
    category: 'clarity',
    availability: 'unavailable',
    status: 'unavailable',
    component: null,
    measurements,
    evidence: [],
    deductions: [],
    warnings: [warning],
  }
}

function notChecked(
  measurements: ClarityMeasurements,
  warning: string,
  evidence: readonly ScoreEvidence[] = [],
): ClarityResult {
  return {
    category: 'clarity',
    availability: 'available',
    status: 'not_checked',
    component: null,
    measurements,
    evidence,
    deductions: [],
    warnings: [warning],
  }
}

function validWords(words: readonly TranscriptWord[], durationMs: number): boolean {
  let previousStart = -1
  let previousEnd = -1

  return words.every((word) => {
    const valid =
      typeof word.word === 'string' &&
      word.word.trim().length > 0 &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.start >= 0 &&
      word.end > word.start &&
      word.end * 1000 <= durationMs &&
      word.start >= previousStart &&
      word.end >= previousEnd

    previousStart = word.start
    previousEnd = word.end
    return valid
  })
}

function confidenceOf(word: TranscriptWord): number | null {
  return typeof word.confidence === 'number' &&
    Number.isFinite(word.confidence) &&
    word.confidence >= 0 &&
    word.confidence <= 1
    ? word.confidence
    : null
}

function lowerDecile(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.1)))
}

function checkCapture(capture: CaptureMetrics, words: readonly TranscriptWord[]): CaptureCheck {
  const durationMs = capture.duration_ms
  const intervalMs = capture.sample_interval_ms

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { status: 'unavailable', warning: 'Audio duration was missing or invalid.' }
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > MAX_SAMPLE_INTERVAL_MS) {
    return { status: 'unavailable', warning: 'Audio sampling cadence was missing or invalid.' }
  }
  if (!validWords(words, durationMs)) {
    return { status: 'unavailable', warning: 'Recognized word timings were invalid.' }
  }

  const samples = capture.amplitude
  const expectedFrames = Math.max(1, Math.floor(durationMs / intervalMs))
  const edgeToleranceMs = Math.max(250, intervalMs * 3)
  const maximumGapMs = Math.max(300, intervalMs * 3)
  let previousTimestamp = -1
  let largestGap = 0

  for (const sample of samples) {
    if (
      !Number.isFinite(sample.t_ms) ||
      sample.t_ms < 0 ||
      sample.t_ms > durationMs ||
      !Number.isFinite(sample.rms) ||
      sample.rms < 0 ||
      sample.rms > 1 ||
      sample.t_ms <= previousTimestamp
    ) {
      return { status: 'unavailable', warning: 'The audio level timeline was invalid.' }
    }
    if (previousTimestamp >= 0) {
      largestGap = Math.max(largestGap, sample.t_ms - previousTimestamp)
    }
    previousTimestamp = sample.t_ms
  }

  const first = samples[0]
  const last = samples.at(-1)
  if (
    !first ||
    !last ||
    first.t_ms > edgeToleranceMs ||
    durationMs - last.t_ms > edgeToleranceMs ||
    samples.length < expectedFrames * MIN_CAPTURE_DENSITY ||
    largestGap > maximumGapMs
  ) {
    return {
      status: 'unavailable',
      warning: 'The audio level timeline was incomplete or interrupted.',
    }
  }

  const speechFrames: number[] = []
  const surroundingFrames: number[] = []
  for (const sample of samples) {
    const seconds = sample.t_ms / 1000
    const insideWord = words.some((word) => seconds >= word.start && seconds <= word.end)
    if (insideWord) speechFrames.push(sample.rms)
    else surroundingFrames.push(sample.rms)
  }

  if (speechFrames.length < MIN_SPEECH_SAMPLES) {
    return {
      status: 'not_checked',
      warning: 'Too little recognized-word audio was available to assess intelligibility.',
    }
  }

  const speechLevel = median(speechFrames)
  const noisePool =
    surroundingFrames.length >= MIN_SPEECH_SAMPLES
      ? surroundingFrames
      : lowerDecile(samples.map((sample) => sample.rms))
  const noiseLevel = median(noisePool)
  const speechToNoiseRatio = speechLevel / Math.max(noiseLevel, Number.EPSILON)

  if (
    !Number.isFinite(speechLevel) ||
    !Number.isFinite(noiseLevel) ||
    !Number.isFinite(speechToNoiseRatio) ||
    speechLevel < MIN_SPEECH_LEVEL ||
    speechToNoiseRatio < MIN_SPEECH_TO_NOISE_RATIO
  ) {
    return {
      status: 'not_checked',
      warning:
        'The recording did not separate recognized speech clearly from the surrounding audio.',
    }
  }

  return { status: 'available', audio: { speechLevel, noiseLevel, speechToNoiseRatio } }
}

function wordEvidence(words: readonly TranscriptWord[]): ScoreEvidence[] {
  return words.slice(0, MAX_WORD_EVIDENCE).map((word) => ({
    source: 'deepgram_word_confidence',
    start: word.start,
    end: word.end,
    quote: word.word,
    detail: `Recognition confidence for this word was ${(confidenceOf(word) ?? 0).toFixed(2)}.`,
  }))
}

/** Evaluates response intelligibility from recognition and recording evidence only. */
function analyseClarityV1(
  words: readonly TranscriptWord[],
  capture?: CaptureMetrics | null,
): ClarityResult {
  let measurements = baseMeasurements(words, capture)
  if (!capture) return unavailable(measurements, 'Audio capture evidence was unavailable.')
  if (words.length < MIN_CLARITY_WORDS) {
    return notChecked(measurements, 'Too little recognized speech was available to assess clarity.')
  }

  const validConfidenceWords = words.filter((word) => confidenceOf(word) !== null)
  const confidences = validConfidenceWords.map((word) => confidenceOf(word) as number)
  const coverage = validConfidenceWords.length / words.length
  measurements = {
    ...measurements,
    confidence_word_count: validConfidenceWords.length,
    confidence_coverage: coverage,
    median_word_confidence: confidences.length > 0 ? median(confidences) : null,
  }
  if (coverage < MIN_CONFIDENCE_COVERAGE) {
    return notChecked(
      measurements,
      'Word recognition confidence was incomplete, so clarity was not checked.',
    )
  }

  const captureCheck = checkCapture(capture, words)
  if (captureCheck.status === 'unavailable') {
    return unavailable(measurements, captureCheck.warning)
  }
  if (captureCheck.status === 'not_checked') {
    return notChecked(measurements, captureCheck.warning)
  }

  const lowConfidenceWords = validConfidenceWords.filter(
    (word) => (confidenceOf(word) as number) < LOW_WORD_CONFIDENCE,
  )
  const lowProportion = lowConfidenceWords.length / validConfidenceWords.length
  measurements = {
    ...measurements,
    low_confidence_count: lowConfidenceWords.length,
    low_confidence_proportion: lowProportion,
    amplitude_frame_count: capture.amplitude.length,
    speech_level: captureCheck.audio.speechLevel,
    noise_level: captureCheck.audio.noiseLevel,
    speech_to_noise_ratio: captureCheck.audio.speechToNoiseRatio,
  }

  const uncertainEvidence = wordEvidence(lowConfidenceWords)
  const audioEvidence: ScoreEvidence = {
    source: 'audio_timeline',
    start: 0,
    end: capture.duration_ms,
    quote: null,
    detail: `Recognized-word audio was ${captureCheck.audio.speechToNoiseRatio.toFixed(1)} times the surrounding level.`,
  }

  if (lowProportion >= GLOBAL_UNCERTAINTY_PROPORTION) {
    return notChecked(
      measurements,
      'Recognition evidence was globally uncertain, so clarity was not scored.',
      [...uncertainEvidence, audioEvidence],
    )
  }

  const component = clamp01(1 - lowProportion)
  const warnings =
    lowConfidenceWords.length > MAX_WORD_EVIDENCE
      ? [`Low-confidence word evidence was limited to ${MAX_WORD_EVIDENCE} items.`]
      : []
  const summaryEvidence: ScoreEvidence = {
    source: 'deepgram_word_confidence',
    start: words[0]?.start ?? null,
    end: words.at(-1)?.end ?? null,
    quote: null,
    detail:
      lowConfidenceWords.length === 0
        ? 'Most of the response was transcribed clearly.'
        : `${lowConfidenceWords.length} recognized words had lower transcription confidence.`,
  }

  return {
    category: 'clarity',
    availability: 'available',
    status: 'scored',
    component,
    measurements,
    evidence: [summaryEvidence, ...uncertainEvidence, audioEvidence],
    deductions:
      lowConfidenceWords.length > 0
        ? [
            {
              id: 'recognition_uncertainty',
              component_reduction: 1 - component,
              detail: 'Scattered low-confidence words reduced the clarity component.',
            },
          ]
        : [],
    warnings,
  }
}

function pronunciationOverlay(value: unknown): {
  measurements: Pick<
    ClarityMeasurements,
    | 'pronunciation_status'
    | 'pronunciation_assessed_word_count'
    | 'pronunciation_matched_word_count'
    | 'pronunciation_phoneme_evidence_count'
  >
  evidence: readonly ScoreEvidence[]
  warnings: readonly string[]
} {
  if (value === undefined || value === null) {
    return {
      measurements: {
        pronunciation_status: 'missing',
        pronunciation_assessed_word_count: 0,
        pronunciation_matched_word_count: 0,
        pronunciation_phoneme_evidence_count: 0,
      },
      evidence: [],
      warnings: [],
    }
  }
  const parsed = parsePronunciationEvaluation(value)
  if (!parsed.ok) {
    return {
      measurements: {
        pronunciation_status: 'malformed',
        pronunciation_assessed_word_count: 0,
        pronunciation_matched_word_count: 0,
        pronunciation_phoneme_evidence_count: 0,
      },
      evidence: [],
      warnings: [],
    }
  }
  const assessedWords = parsed.value.words.filter(
    (word) => word.pronunciationAvailability === 'available',
  )
  const matchedWords = assessedWords.filter((word) => word.lexicalOutcome === 'match')
  const phonemeCount = matchedWords.reduce((sum, word) => sum + word.phonemes.length, 0)
  const evidence = matchedWords.flatMap((word) => {
    if (word.startMs === null || word.endMs === null || word.recognizedWord === null) return []
    const start = word.startMs / 1000
    const end = word.endMs / 1000
    const wordEvidence: ScoreEvidence = {
      source: 'azure_pronunciation',
      start,
      end,
      quote: word.recognizedWord,
      detail: `Word-level sound evidence was available for "${word.recognizedWord}".`,
    }
    const soundEvidence = word.phonemes.flatMap((phoneme) =>
      phoneme.expected
        ? [
            {
              source: 'azure_pronunciation',
              start,
              end,
              quote: word.recognizedWord,
              detail: `Sound evidence for "${phoneme.expected}" in "${word.recognizedWord}" was available.`,
            } satisfies ScoreEvidence,
          ]
        : [],
    )
    return [wordEvidence, ...soundEvidence]
  })
  return {
    measurements: {
      pronunciation_status: parsed.value.status,
      pronunciation_assessed_word_count: assessedWords.length,
      pronunciation_matched_word_count: matchedWords.length,
      pronunciation_phoneme_evidence_count: phonemeCount,
    },
    evidence: evidence.slice(0, MAX_WORD_EVIDENCE),
    warnings:
      evidence.length > 0
        ? ['Provider sound evidence is informational and does not change this score.']
        : [],
  }
}

/** Adds optional provider evidence without changing the Clarity v1 decision. */
export function analyseClarity(
  words: readonly TranscriptWord[],
  capture?: CaptureMetrics | null,
  pronunciation?: unknown,
): ClarityResult {
  const base = analyseClarityV1(words, capture)
  const overlay = pronunciationOverlay(pronunciation)
  return {
    ...base,
    measurements: { ...base.measurements, ...overlay.measurements },
    evidence: [...base.evidence, ...overlay.evidence],
    warnings: [...base.warnings, ...overlay.warnings],
  }
}
