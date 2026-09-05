import { describe, expect, it } from 'vitest'
import { readAttemptResult, storedTranscriptWords } from '@/lib/results/attempt-result'
import { v3Snapshot } from './helpers/result-snapshots'

function input(sectionScores: unknown = v3Snapshot()) {
  return {
    id: 'attempt-1',
    promptText: 'Prompt',
    transcript: 'A response.',
    durationMs: 1_000,
    createdAt: '2026-09-05T12:00:00.000Z',
    audioUrl: null,
    score: 80,
    sectionScores,
    metrics: {},
    contentResult: {},
  }
}

describe('attempt result decoding', () => {
  it('returns the current v3.2 payload', () => {
    expect(readAttemptResult(input())).toMatchObject({ kind: 'v3', payload: { version: 'v3.score.2' } })
  })

  it('preserves a resultless terminal shape as incomplete', () => {
    expect(
      readAttemptResult({
        ...input(null),
        score: null,
        contentResult: null,
      }),
    ).toEqual({ kind: 'incomplete' })
  })

  it('fails closed for old and future versions', () => {
    expect(readAttemptResult(input({ ...v3Snapshot(), version: 'v3.score.1' }))).toMatchObject({
      kind: 'unsupported_version',
      scoreVersion: 'v3.score.1',
    })
    expect(readAttemptResult(input({ ...v3Snapshot(), version: 'v3.score.99' }))).toMatchObject({
      kind: 'unsupported_version',
      scoreVersion: 'v3.score.99',
    })
  })

  it('does not convert partial stored fields into an incomplete result', () => {
    expect(readAttemptResult({ ...input(null), score: 80 })).toEqual({ kind: 'malformed' })
  })

  it('accepts only ordered, bounded transcript words', () => {
    const words = [
      { word: 'A', start: 0, end: 0.2, confidence: 0.9 },
      { word: 'response', start: 0.3, end: 0.8, confidence: 0.8 },
    ]
    expect(storedTranscriptWords({ transcript: { words } })).toEqual(words)
    expect(storedTranscriptWords({ transcript: { words: [...words].reverse() } })).toEqual([])
    expect(storedTranscriptWords({ transcript: { words: [{ ...words[0], confidence: 2 }] } })).toEqual([])
  })
})
