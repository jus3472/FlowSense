import { describe, expect, it } from 'vitest'
import {
  collectionLabel,
  formatExpectedDuration,
  parsePracticeBrowseParams,
  parsePracticeMode,
  parseRecordPromptParam,
  practiceBrowseHref,
  recordHrefForPrompt,
} from '@/lib/practice/navigation'

const PROMPT_ID = '11111111-1111-4111-8111-111111111111'

describe('practice navigation', () => {
  it('validates mode segments and browser filters', () => {
    expect(parsePracticeMode('presentation')).toBe('presentation')
    expect(parsePracticeMode('custom')).toBeNull()
    expect(
      parsePracticeBrowseParams({ difficulty: 'advanced', collection: 'problem_solving' }),
    ).toEqual({
      difficulty: 'advanced',
      collectionId: 'problem_solving',
    })
    expect(
      parsePracticeBrowseParams({ difficulty: ['advanced'], collection: 'not-valid' }),
    ).toEqual({})
  })

  it('builds stable browse and explicit prompt links', () => {
    expect(
      practiceBrowseHref('interview', { difficulty: 'advanced', collectionId: 'problem_solving' }),
    ).toBe('/practice/interview?difficulty=advanced&collection=problem_solving')
    expect(recordHrefForPrompt(PROMPT_ID)).toBe(`/record?prompt=${PROMPT_ID}`)
  })

  it('fails closed for malformed or repeated explicit prompt IDs', () => {
    expect(parseRecordPromptParam(undefined)).toBeUndefined()
    expect(parseRecordPromptParam(PROMPT_ID)).toBe(PROMPT_ID)
    expect(parseRecordPromptParam('not-an-id')).toBeNull()
    expect(parseRecordPromptParam([PROMPT_ID, PROMPT_ID])).toBeNull()
  })

  it('uses readable collection and expected-duration labels', () => {
    expect(collectionLabel('spontaneous_description')).toBe('Spontaneous description')
    expect(formatExpectedDuration(45)).toBe('About 45 seconds')
    expect(formatExpectedDuration(60)).toBe('About 1 minute')
  })
})
