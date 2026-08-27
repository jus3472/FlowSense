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
      intelligibility: 'intelligible',
    })
    expect(substitution.value.words[0]).toMatchObject({
      lexicalOutcome: 'substitution',
      pronunciationAccuracy: null,
    })
    expect(unusual.value.eligibleForDeductions).toBe(false)
    expect(substitution.value.eligibleForDeductions).toBe(false)
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
    expect(missingPhonemes.value.words[0]?.stressProsody.availability).toBe('unsupported')
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

  it('pins the independent contract version', () => {
    expect(PRONUNCIATION_CONTRACT_VERSION).toBe('v1')
  })
})
