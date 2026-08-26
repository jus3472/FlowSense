import { describe, expect, it } from 'vitest'
import { DeepgramParseError, parseDeepgramResponse } from '@/lib/deepgram/parse'
import { buildDeepgramUrl, deepgramAuthHeader, isFillerToken } from '@/lib/deepgram/request'

/** Shaped after a real nova-3 response with filler_words=true and punctuate=true. */
const RESPONSE_WITH_FILLERS = {
  metadata: { duration: 6.909375, models: ['2187e11a'] },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'So, um, I think the main thing is, uh, that I like problems.',
            confidence: 0.995,
            words: [
              { word: 'so', start: 0, end: 0.4, confidence: 0.93, punctuated_word: 'So,' },
              { word: 'um', start: 0.4, end: 0.72, confidence: 0.977, punctuated_word: 'um,' },
              { word: 'i', start: 0.72, end: 1.04, confidence: 0.99, punctuated_word: 'I' },
              { word: 'think', start: 1.04, end: 1.2, confidence: 1, punctuated_word: 'think' },
              { word: 'uh', start: 2, end: 2.24, confidence: 0.96, punctuated_word: 'uh,' },
            ],
          },
        ],
      },
    ],
  },
}

describe('parseDeepgramResponse', () => {
  it('keeps the punctuated transcript', () => {
    const parsed = parseDeepgramResponse(RESPONSE_WITH_FILLERS)
    expect(parsed.transcript).toBe('So, um, I think the main thing is, uh, that I like problems.')
    expect(parsed.transcript).toMatch(/[.,]/)
  })

  it('keeps filler tokens as words rather than dropping them', () => {
    const parsed = parseDeepgramResponse(RESPONSE_WITH_FILLERS)
    expect(parsed.words.map((entry) => entry.word)).toEqual(['so', 'um', 'i', 'think', 'uh'])
  })

  it('keeps start and end on every word', () => {
    const parsed = parseDeepgramResponse(RESPONSE_WITH_FILLERS)
    expect(parsed.words[1]).toEqual({ word: 'um', start: 0.4, end: 0.72, confidence: 0.977 })
    for (const entry of parsed.words) {
      expect(Number.isFinite(entry.start)).toBe(true)
      expect(Number.isFinite(entry.end)).toBe(true)
    }
  })

  it('reads confidence and duration off the response', () => {
    const parsed = parseDeepgramResponse(RESPONSE_WITH_FILLERS)
    expect(parsed.confidence).toBe(0.995)
    expect(parsed.durationSeconds).toBe(6.909375)
  })

  it('accepts silence, which is an empty transcript with no words', () => {
    const parsed = parseDeepgramResponse({
      results: { channels: [{ alternatives: [{ transcript: '', words: [] }] }] },
    })
    expect(parsed.transcript).toBe('')
    expect(parsed.words).toEqual([])
    expect(parsed.confidence).toBeNull()
  })

  it('drops word entries that are missing a timing', () => {
    const parsed = parseDeepgramResponse({
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: 'one two',
                words: [
                  { word: 'one', start: 0, end: 0.2 },
                  { word: 'two', start: 0.2 },
                  { start: 0.4, end: 0.6 },
                  'not an object',
                ],
              },
            ],
          },
        ],
      },
    })
    expect(parsed.words).toEqual([{ word: 'one', start: 0, end: 0.2 }])
  })

  it.each([
    ['a string', 'nope'],
    ['no results', {}],
    ['no channels', { results: {} }],
    ['an empty channel list', { results: { channels: [] } }],
    ['no alternatives', { results: { channels: [{}] } }],
    ['an empty alternative list', { results: { channels: [{ alternatives: [] }] } }],
  ])('throws on %s', (_label, payload) => {
    expect(() => parseDeepgramResponse(payload)).toThrow(DeepgramParseError)
  })
})

describe('buildDeepgramUrl', () => {
  const url = new URL(buildDeepgramUrl())

  it('calls the pre-recorded listen endpoint', () => {
    expect(url.origin + url.pathname).toBe('https://api.deepgram.com/v1/listen')
  })

  /**
   * Nova-3 accepts filler_words and ignores it on natural speech, so the
   * transcript comes back clean and every filler measurement silently reads
   * zero. Changing this model is a scoring change, not a version bump.
   */
  it('asks nova-2, the model that actually honours filler words', () => {
    expect(url.searchParams.get('model')).toBe('nova-2')
    expect(url.searchParams.get('filler_words')).toBe('true')
    expect(url.searchParams.get('punctuate')).toBe('true')
  })

  /** smart_format tidies away the very disfluencies being measured. */
  it('never enables smart_format', () => {
    expect(url.searchParams.has('smart_format')).toBe(false)
  })
})

describe('deepgramAuthHeader', () => {
  it('uses the Token scheme, not Bearer', () => {
    expect(deepgramAuthHeader('abc123')).toBe('Token abc123')
  })
})

describe('isFillerToken', () => {
  it('recognises the tokens Deepgram emits for fillers', () => {
    expect(isFillerToken('um')).toBe(true)
    expect(isFillerToken('uh')).toBe(true)
    expect(isFillerToken('UH')).toBe(true)
    expect(isFillerToken('mhmm')).toBe(true)
  })

  it('does not treat ordinary words as fillers', () => {
    expect(isFillerToken('umbrella')).toBe(false)
    expect(isFillerToken('yeah')).toBe(false)
    expect(isFillerToken('')).toBe(false)
  })
})
