import { describe, expect, it } from 'vitest'
import type { StoredContentResult } from '@/lib/scoring/assemble'
import {
  resolveLegacyDispute,
  validLegacyDisputes,
  WORD_CHOICE_SPAN_NOTE,
} from '@/lib/scoring/disputes'

function content(overrides: Partial<StoredContentResult> = {}): StoredContentResult {
  return {
    status: 'checked',
    model: 'legacy-model',
    error: null,
    checks: {
      answered: {
        passed: false,
        severity: 'clear',
        quote: 'I chose the second approach.',
        observation: 'The response did not answer the prompt.',
        suggestion: null,
      },
      explained: {
        passed: true,
        severity: null,
        quote: null,
        observation: null,
        suggestion: null,
      },
      word_choice: {
        passed: false,
        severity: 'minor',
        quote: 'kind of useful',
        observation: 'This phrase is imprecise.',
        suggestion: 'Name the specific benefit.',
      },
      logical_order: {
        passed: true,
        severity: null,
        quote: null,
        observation: null,
        suggestion: null,
      },
      no_repetition: {
        passed: true,
        severity: null,
        quote: null,
        observation: null,
        suggestion: null,
      },
    },
    extra_spans: [{ text: 'kind of useful', category: 'imprecise' }],
    tightened: null,
    tightened_outcome: 'none',
    dropped: [],
    points: { answered: 0, explained: 12, word_choice: 9, logical_order: 7, no_repetition: 5 },
    disputes_applied: 0,
    ...overrides,
  }
}

describe('legacy dispute resolution', () => {
  it('accepts only an exact currently failing stored check', () => {
    expect(resolveLegacyDispute(content(), 'answered', 'I chose the second approach.')).toEqual({
      ok: true,
      dispute: { note_type: 'answered', quote: 'I chose the second approach.' },
    })
    expect(resolveLegacyDispute(content(), 'explained', null)).toEqual({
      ok: false,
      reason: 'not_failing',
    })
    expect(resolveLegacyDispute(content(), 'answered', 'second approach')).toEqual({
      ok: false,
      reason: 'quote_mismatch',
    })
    expect(resolveLegacyDispute(content(), 'energy', null)).toEqual({
      ok: false,
      reason: 'invalid_input',
    })
  })

  it('accepts only an exact stored word-choice span', () => {
    expect(resolveLegacyDispute(content(), WORD_CHOICE_SPAN_NOTE, 'kind of useful')).toEqual({
      ok: true,
      dispute: { note_type: WORD_CHOICE_SPAN_NOTE, quote: 'kind of useful' },
    })
    expect(resolveLegacyDispute(content(), WORD_CHOICE_SPAN_NOTE, 'useful')).toEqual({
      ok: false,
      reason: 'quote_mismatch',
    })
    expect(resolveLegacyDispute(content(), WORD_CHOICE_SPAN_NOTE, null)).toEqual({
      ok: false,
      reason: 'quote_mismatch',
    })
  })

  it('rejects findings when legacy content was not checked', () => {
    expect(resolveLegacyDispute(content({ status: 'not_checked' }), 'answered', null)).toEqual({
      ok: false,
      reason: 'not_checked',
    })
  })

  it('filters forged historical rows and collapses exact duplicates', () => {
    expect(
      validLegacyDisputes(content(), [
        { note_type: 'answered', quote: 'I chose the second approach.' },
        { note_type: 'answered', quote: 'I chose the second approach.' },
        { note_type: 'explained', quote: null },
        { note_type: WORD_CHOICE_SPAN_NOTE, quote: 'kind of useful' },
        { note_type: WORD_CHOICE_SPAN_NOTE, quote: 'forged span' },
      ]),
    ).toEqual([
      { note_type: 'answered', quote: 'I chose the second approach.' },
      { note_type: WORD_CHOICE_SPAN_NOTE, quote: 'kind of useful' },
    ])
  })
})
