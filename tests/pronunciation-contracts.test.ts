import { describe, expect, it } from 'vitest'
import fixtures from '../fixtures/pronunciation/provider-fixtures.json'
import {
  PRONUNCIATION_CONTRACT_VERSION,
  parsePronunciationEvaluation,
} from '@/lib/pronunciation/contracts'
import { runPronunciationHarness } from '@/lib/pronunciation/harness'

describe('pronunciation provider-neutral contract', () => {
  it('runs the complete local fixture harness without a provider call', () => {
    const result = runPronunciationHarness(fixtures)

    expect(result.passed).toBe(true)
    expect(result.cases).toHaveLength(7)
    expect(result.cases.every((item) => item.passed)).toBe(true)
  })

  it('keeps a lexical match with unusual pronunciation separate from a substitution', () => {
    const unusual = parsePronunciationEvaluation(fixtures[0]?.response)
    const substitution = parsePronunciationEvaluation(fixtures[1]?.response)
    if (!unusual.ok || !substitution.ok) throw new Error('Fixture parsing failed.')

    expect(unusual.value.words[0]).toMatchObject({
      lexicalOutcome: 'match',
      pronunciationAccuracy: 0.52,
    })
    expect(substitution.value.words[0]).toMatchObject({
      lexicalOutcome: 'substitution',
      pronunciationAccuracy: null,
    })
    expect(unusual.value.eligibleForDeductions).toBe(false)
    expect(substitution.value.eligibleForDeductions).toBe(false)
    expect(fixtures[0]?.expected.groundTruthIntelligibility).toBe('intelligible')
  })

  it('keeps unsupported words, missing phoneme support, and outages explicit', () => {
    const unsupported = parsePronunciationEvaluation(fixtures[2]?.response)
    const outage = parsePronunciationEvaluation(fixtures[3]?.response)
    const missingPhonemes = parsePronunciationEvaluation(fixtures[5]?.response)
    if (!unsupported.ok || !outage.ok || !missingPhonemes.ok)
      throw new Error('Fixture parsing failed.')

    expect(unsupported.value.words[0]?.lexicalOutcome).toBe('unsupported')
    expect(unsupported.value.unsupportedWords).toEqual(['FlowSense'])
    expect(outage.value).toMatchObject({
      status: 'failed',
      error: { code: 'outage', retryable: true },
    })
    expect(missingPhonemes.value.words[0]?.phonemes).toEqual([])
    expect(missingPhonemes.value.words[0]?.phonemeAvailability).toBe('unsupported')
  })

  it('fails closed for malformed provider output', () => {
    const malformed = parsePronunciationEvaluation(fixtures[4]?.response)

    expect(malformed).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'malformed_response', retryable: true }),
    })
  })

  it('rejects a completed result that tries to become deductible', () => {
    const source = fixtures[0]?.response as Record<string, unknown>
    const parsed = parsePronunciationEvaluation({ ...source, eligibleForDeductions: true })

    expect(parsed.ok).toBe(false)
  })

  it('rejects contradictory lexical, availability, timing, and status evidence', () => {
    const source = fixtures[0]?.response as Record<string, unknown>
    const word = (source.words as Record<string, unknown>[])[0]
    const contradictory = (changes: Record<string, unknown>) =>
      parsePronunciationEvaluation({ ...source, words: [{ ...word, ...changes }] })

    expect(contradictory({ recognizedWord: 'watered' }).ok).toBe(false)
    expect(contradictory({ pronunciationAccuracy: null }).ok).toBe(false)
    expect(contradictory({ startMs: 1, endMs: null }).ok).toBe(false)
    expect(parsePronunciationEvaluation({ ...source, status: 'failed', error: null }).ok).toBe(
      false,
    )
  })

  it('fails the library harness when phoneme support regresses', () => {
    const missingSupport = fixtures[5]
    if (!missingSupport) throw new Error('Fixture was missing.')
    const sourceWords = missingSupport.response.words
    if (!sourceWords) throw new Error('Fixture words were missing.')
    const mutated = {
      ...missingSupport,
      response: {
        ...missingSupport.response,
        words: sourceWords.map((word) => ({
          ...word,
          phonemeAvailability: 'available',
          phonemes: [{ expected: 'b', recognized: 'b', accuracy: 1, startMs: 0, endMs: 80 }],
        })),
      },
    }

    const result = runPronunciationHarness([mutated])
    expect(result.passed).toBe(false)
    expect(result.cases[0]?.checks).toContain('phoneme support mismatch')
  })

  it('pins the independent contract version', () => {
    expect(PRONUNCIATION_CONTRACT_VERSION).toBe('v1')
  })
})
