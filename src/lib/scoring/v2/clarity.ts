import type { TranscriptWord } from '@/lib/deepgram/parse'
import type { CaptureMetrics } from '@/lib/types/metrics'

export interface ClarityResult {
  category: 'clarity'
  status: 'scored' | 'not_checked' | 'unavailable'
  component: number | null
  measurements: { word_count: number; confidence_word_count: number; low_confidence_count: number; low_confidence_proportion: number | null }
  evidence: readonly { source: 'transcript' | 'audio'; quote: string | null; detail: string }[]
  deductions: readonly string[]
  warnings: readonly string[]
}

const LOW = 0.75

/** Measures recognition evidence only; it makes no claim about accent or pronunciation. */
export function analyseClarity(words: readonly TranscriptWord[], capture?: CaptureMetrics | null): ClarityResult {
  const confident = words.filter((word) => typeof word.confidence === 'number' && Number.isFinite(word.confidence) && word.confidence >= 0 && word.confidence <= 1)
  const base = { word_count: words.length, confidence_word_count: confident.length, low_confidence_count: 0, low_confidence_proportion: null }
  if (words.length < 3) return { category: 'clarity', status: 'not_checked', component: null, measurements: base, evidence: [], deductions: [], warnings: ['Too little recognized speech to assess clarity.'] }
  if (confident.length < 3) return { category: 'clarity', status: 'not_checked', component: null, measurements: base, evidence: [], deductions: [], warnings: ['Word recognition confidence was unavailable.'] }
  const low = confident.filter((word) => word.confidence! < LOW)
  const proportion = low.length / confident.length
  const measurements = { ...base, low_confidence_count: low.length, low_confidence_proportion: proportion }
  if (!capture || capture.amplitude.length === 0) return { category: 'clarity', status: 'unavailable', component: null, measurements, evidence: [], deductions: [], warnings: ['Audio capture evidence was unavailable.'] }
  const quotes = low.slice(0, 3).map((word) => word.word).join(', ')
  if (proportion >= 0.6) return { category: 'clarity', status: 'not_checked', component: null, measurements, evidence: [{ source: 'transcript', quote: quotes || null, detail: 'Most recognized words had low transcription confidence.' }], deductions: [], warnings: ['Recognition evidence was globally uncertain, so no personal clarity score was assigned.'] }
  return { category: 'clarity', status: 'scored', component: Math.max(0, 1 - proportion), measurements, evidence: low.length ? [{ source: 'transcript', quote: quotes, detail: 'These words were more difficult to recognize.' }] : [{ source: 'transcript', quote: null, detail: 'Most of the response was transcribed clearly.' }], deductions: low.length ? ['Scattered low-confidence words reduced the clarity component.'] : [], warnings: [] }
}
