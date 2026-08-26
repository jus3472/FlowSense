import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { CaptureMetrics } from '@/lib/types/metrics'
import type { ScoreEvidence } from '@/lib/scoring/v2/contracts'

export interface ClarityResult {
  category: 'clarity'
  status: 'scored' | 'not_checked' | 'unavailable'
  component: number | null
  measurements: { word_count: number; confidence_word_count: number; low_confidence_count: number; low_confidence_proportion: number | null }
  evidence: readonly ScoreEvidence[]
  deductions: readonly string[]
  warnings: readonly string[]
}

const LOW = 0.75
const MIN_WORDS = 8
const MIN_COVERAGE = 0.8

function captureIsUsable(capture: CaptureMetrics | null | undefined): boolean {
  if (!capture || !Number.isFinite(capture.duration_ms) || capture.duration_ms <= 0 || !Number.isFinite(capture.sample_interval_ms) || capture.sample_interval_ms <= 0 || capture.amplitude.length < 3) return false
  let previous = -1
  for (const sample of capture.amplitude) { if (!Number.isFinite(sample.t_ms) || !Number.isFinite(sample.rms) || sample.t_ms < previous || sample.rms < 0) return false; previous = sample.t_ms }
  return previous >= capture.duration_ms * .8 && capture.amplitude.some((sample) => sample.rms > 0)
}

/** Measures recognition evidence only; it makes no claim about accent or pronunciation. */
export function analyseClarity(words: readonly TranscriptWord[], capture?: CaptureMetrics | null): ClarityResult {
  const confident = words.filter((word) => typeof word.confidence === 'number' && Number.isFinite(word.confidence) && word.confidence >= 0 && word.confidence <= 1)
  const base = { word_count: words.length, confidence_word_count: confident.length, low_confidence_count: 0, low_confidence_proportion: null }
  if (words.length < MIN_WORDS) return { category: 'clarity', status: 'not_checked', component: null, measurements: base, evidence: [], deductions: [], warnings: ['Too little recognized speech to assess clarity.'] }
  if (confident.length / words.length < MIN_COVERAGE) return { category: 'clarity', status: 'not_checked', component: null, measurements: base, evidence: [], deductions: [], warnings: ['Word recognition confidence was incomplete.'] }
  const low = confident.filter((word) => word.confidence! < LOW)
  const proportion = low.length / confident.length
  const measurements = { ...base, low_confidence_count: low.length, low_confidence_proportion: proportion }
  if (!captureIsUsable(capture)) return { category: 'clarity', status: 'unavailable', component: null, measurements, evidence: [], deductions: [], warnings: ['Audio capture evidence was unavailable or unusable.'] }
  const evidence = low.map((word) => ({ source: 'transcript', start: word.start, end: word.end, quote: word.word, detail: 'This word was difficult to recognize.' }))
  if (proportion >= 0.6) return { category: 'clarity', status: 'not_checked', component: null, measurements, evidence, deductions: [], warnings: ['Recognition evidence was globally uncertain.'] }
  return { category: 'clarity', status: 'scored', component: Math.max(0, 1 - proportion), measurements, evidence, deductions: low.length ? ['Scattered low-confidence words reduced the clarity component.'] : [], warnings: [] }
}
