import { describe, expect, it } from 'vitest'
import { readStoredCompletedTranscription } from '@/lib/attempts/transcription'

const TRANSCRIPT = 'This works well.'
const WORDS = [
  { word: 'this', start: 0.2, end: 0.5, confidence: 0.98 },
  { word: 'works', start: 0.55, end: 0.9, confidence: 0.96 },
  { word: 'well', start: 0.95, end: 1.2, confidence: 0.94 },
]

function metrics(overrides: Record<string, unknown> = {}) {
  return {
    transcript: {
      provider: 'deepgram',
      model: 'nova-2',
      confidence: 0.97,
      words: WORDS,
      duration_seconds: 1.5,
      quality: { status: 'usable', diagnostics: [] },
      ...overrides,
    },
  }
}

describe('stored completed transcription', () => {
  it('returns transcript and timed word evidence only after structural validation', () => {
    expect(readStoredCompletedTranscription(TRANSCRIPT, metrics())).toEqual({
      transcript: TRANSCRIPT,
      words: WORDS,
    })
  })

  it('accepts historical completed snapshots without optional quality or duration', () => {
    const stored = metrics({ quality: undefined, duration_seconds: undefined, confidence: null })
    expect(readStoredCompletedTranscription(TRANSCRIPT, stored)?.words).toHaveLength(3)
  })

  it.each([
    ['missing transcript', null, metrics()],
    ['empty transcript', '   ', metrics()],
    ['missing metrics', TRANSCRIPT, null],
    ['wrong provider', TRANSCRIPT, metrics({ provider: 'other' })],
    ['empty model', TRANSCRIPT, metrics({ model: '' })],
    ['missing words', TRANSCRIPT, metrics({ words: undefined })],
    ['empty words', TRANSCRIPT, metrics({ words: [] })],
    ['invalid confidence', TRANSCRIPT, metrics({ confidence: 2 })],
    ['invalid duration', TRANSCRIPT, metrics({ duration_seconds: Number.NaN })],
    [
      'unavailable quality',
      TRANSCRIPT,
      metrics({ quality: { status: 'unavailable', diagnostics: ['bad'] } }),
    ],
    ['mismatched words', TRANSCRIPT, metrics({ words: WORDS.slice(0, 2) })],
    [
      'nonmonotonic timings',
      TRANSCRIPT,
      metrics({ words: [WORDS[0], { ...WORDS[1], start: 0.1 }, WORDS[2]] }),
    ],
  ])('rejects %s so the provider path can recover', (_label, transcript, storedMetrics) => {
    expect(readStoredCompletedTranscription(transcript, storedMetrics)).toBeNull()
  })
})
