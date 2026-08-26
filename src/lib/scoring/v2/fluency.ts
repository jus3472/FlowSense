import type { TranscriptWord } from '@/lib/deepgram/parse'
import { analyseFillers } from '@/lib/scoring/fillers'
import { FILLER_FREE_RATE, pauseBurden } from '@/lib/scoring/mechanical'
import { analysePace } from '@/lib/scoring/pace'
import { analysePauses } from '@/lib/scoring/pauses'
import { ramp } from '@/lib/scoring/scale'
import { analyseTimeToFirstWord } from '@/lib/scoring/time-to-first-word'
import { buildTokens } from '@/lib/scoring/tokens'
import type { CaptureMetrics } from '@/lib/types/metrics'
import type { ScoreEvidence, ScoreStatus } from '@/lib/scoring/v2/contracts'

const MINIMUM_WORDS = 3

export interface FluencyEvaluationInput {
  capture: Pick<CaptureMetrics, 'duration_ms' | 'amplitude'> | null | undefined
  words: readonly TranscriptWord[]
  transcript: string
}

export interface FluencyMeasurements {
  word_count: number
  filler_rate_per_100_words: number
  filler_count: number
  mid_sentence_pause_count: number
  pause_burden_per_minute: number
  total_silence_ms: number
  leading_silence_ms: number
  trailing_silence_ms: number
  speaking_ms: number
  continuity_ratio: number
  words_per_minute: number
  time_to_first_word_seconds: number
  restart_count: number
  backtrack_count: number
}

export interface FluencyDeduction {
  id: 'filler_rate' | 'mid_sentence_pauses' | 'articulation_pace' | 'time_to_first_word'
  component: number
  detail: string
}

export interface AvailableFluencyEvaluation {
  category: 'fluency'
  availability: 'available'
  status: Extract<ScoreStatus, 'scored' | 'not_checked'>
  /** A bounded fluency signal only. The rubric owns category weights and points. */
  component: number
  measurements: FluencyMeasurements
  evidence: readonly ScoreEvidence[]
  deductions: readonly FluencyDeduction[]
  warnings: readonly string[]
}

export interface UnavailableFluencyEvaluation {
  category: 'fluency'
  availability: 'unavailable'
  status: 'unavailable'
  component: null
  measurements: null
  evidence: readonly []
  deductions: readonly []
  warnings: readonly string[]
}

export type FluencyEvaluation = AvailableFluencyEvaluation | UnavailableFluencyEvaluation

function unavailable(...warnings: string[]): UnavailableFluencyEvaluation {
  return {
    category: 'fluency',
    availability: 'unavailable',
    status: 'unavailable',
    component: null,
    measurements: null,
    evidence: [],
    deductions: [],
    warnings,
  }
}

function validWords(words: readonly TranscriptWord[]): boolean {
  return words.every(
    (word) =>
      typeof word.word === 'string' &&
      word.word.trim().length > 0 &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.start >= 0 &&
      word.end >= word.start,
  )
}

function average(components: readonly number[]): number {
  return components.reduce((sum, component) => sum + component, 0) / components.length
}

function transcriptEvidence(
  start: number,
  end: number,
  quote: string,
  detail: string,
): ScoreEvidence {
  return { source: 'transcript', start, end, quote, detail }
}

/**
 * Evaluates observable fluency without assigning category points or weights.
 * Legacy detectors remain the source of truth for fillers, pauses, pace, and
 * first-word timing; this module only combines their already-tested outputs.
 */
export function evaluateFluency(input: FluencyEvaluationInput): FluencyEvaluation {
  const { capture, words, transcript } = input
  if (!capture || !Number.isFinite(capture.duration_ms) || capture.duration_ms <= 0) {
    return unavailable('Fluency could not be measured because capture duration was missing or invalid.')
  }
  if (!Array.isArray(capture.amplitude) || capture.amplitude.length === 0) {
    return unavailable('Fluency could not be measured because the amplitude timeline was unavailable.')
  }
  if (transcript.trim().length === 0 || words.length < MINIMUM_WORDS || !validWords(words)) {
    return unavailable(
      `Fluency needs a valid transcript with at least ${MINIMUM_WORDS} timed words to be measured.`,
    )
  }

  const tokens = buildTokens(words, transcript)
  if (tokens.length < MINIMUM_WORDS) {
    return unavailable(
      `Fluency needs at least ${MINIMUM_WORDS} transcript tokens after parsing to be measured.`,
    )
  }

  const fillers = analyseFillers(tokens, tokens.length)
  const fillerIndices = new Set(
    fillers.hits.filter((hit) => hit.category === 'filler').flatMap((hit) => hit.token_indices),
  )
  const pauses = analysePauses(capture.amplitude, words, capture.duration_ms, fillerIndices)
  const pace = analysePace(tokens.length, capture.duration_ms, pauses.total_silence_ms)
  const firstWord = analyseTimeToFirstWord(words, pauses.speech_onset_ms)
  const fillerRate = (fillers.filler_tokens / tokens.length) * 100
  const fillerComponent = ramp(fillerRate, FILLER_FREE_RATE, 9)
  const pauseBurdenPerMinute = pauseBurden(pauses.mid_sentence, capture.duration_ms)
  const pauseComponent = ramp(pauseBurdenPerMinute, 0.4, 3.4)
  const components = [fillerComponent, pauseComponent, pace.component, firstWord.component]

  const evidence: ScoreEvidence[] = []
  for (const hit of fillers.hits.filter((hit) => hit.category === 'filler')) {
    evidence.push(transcriptEvidence(hit.start, hit.end, hit.text, 'Filler detected in the transcript.'))
  }
  for (const pause of pauses.mid_sentence) {
    evidence.push({
      source: 'audio_timeline',
      start: pause.start_ms,
      end: pause.end_ms,
      quote: pause.preceding_word,
      detail: `Mid-sentence pause after “${pause.preceding_word}”.`,
    })
  }
  evidence.push({
    source: 'transcript_and_audio_timeline',
    start: 0,
    end: capture.duration_ms,
    quote: null,
    detail: `${Math.round(pace.words_per_minute)} words per minute over ${(pace.speaking_ms / 1000).toFixed(1)} seconds of speaking time.`,
  })
  evidence.push({
    source: firstWord.source === 'transcript' ? 'transcript' : 'audio_timeline',
    start: 0,
    end: Math.round(firstWord.seconds * 1000),
    quote: words[0]?.word ?? null,
    detail: `${firstWord.seconds.toFixed(2)} seconds to first word from ${firstWord.source}.`,
  })

  const deductions: FluencyDeduction[] = []
  const addDeduction = (id: FluencyDeduction['id'], component: number, detail: string) => {
    if (component < 1) deductions.push({ id, component, detail })
  }
  addDeduction('filler_rate', fillerComponent, `${fillers.filler_tokens} filler tokens per 100 words.`)
  addDeduction(
    'mid_sentence_pauses',
    pauseComponent,
    `${pauses.mid_sentence.length} mid-sentence pauses with ${pauseBurdenPerMinute.toFixed(2)} burden per minute.`,
  )
  addDeduction('articulation_pace', pace.component, `${Math.round(pace.words_per_minute)} words per minute.`)
  addDeduction(
    'time_to_first_word',
    firstWord.component,
    `${firstWord.seconds.toFixed(2)} seconds to first word.`,
  )

  const warnings = [...pauses.warnings]
  if (firstWord.warning) warnings.push(firstWord.warning)
  if (fillers.false_start_tokens > 0) {
    warnings.push(
      `${fillers.false_start_tokens} restart tokens were observed. Restarts are reported but do not reduce fluency.`,
    )
  }
  if (fillers.backtracks.length > 0) {
    warnings.push(
      `${fillers.backtracks.length} self-corrections were observed. Self-corrections are reported but do not reduce fluency.`,
    )
  }

  return {
    category: 'fluency',
    availability: 'available',
    status: 'scored',
    component: average(components),
    measurements: {
      word_count: tokens.length,
      filler_rate_per_100_words: fillerRate,
      filler_count: fillers.filler_tokens,
      mid_sentence_pause_count: pauses.mid_sentence.length,
      pause_burden_per_minute: pauseBurdenPerMinute,
      total_silence_ms: pauses.total_silence_ms,
      leading_silence_ms: pauses.leading_silence_ms,
      trailing_silence_ms: pauses.trailing_silence_ms,
      speaking_ms: pace.speaking_ms,
      continuity_ratio: pace.speaking_ms / capture.duration_ms,
      words_per_minute: pace.words_per_minute,
      time_to_first_word_seconds: firstWord.seconds,
      restart_count: fillers.false_start_tokens,
      backtrack_count: fillers.backtracks.length,
    },
    evidence,
    deductions,
    warnings,
  }
}
