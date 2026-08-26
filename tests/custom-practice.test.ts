import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  isCustomPracticeMarker,
  parseCustomPracticeCookie,
  parseCustomPracticeInput,
  serializeCustomPracticeInput,
} from '@/lib/practice/custom'

const valid = {
  promptText: 'Explain a choice you made.',
  mode: 'practice' as const,
  additionalContext: 'Keep it brief.',
  targetDurationSeconds: 30,
}

describe('custom practice input', () => {
  it('trims and round-trips a private transport payload', () => {
    const parsed = parseCustomPracticeInput({
      ...valid,
      promptText: '  Explain a choice you made.  ',
    })
    expect(parsed).toEqual(valid)
    expect(parseCustomPracticeCookie(serializeCustomPracticeInput(valid))).toEqual(valid)
  })
  it.each([
    { ...valid, promptText: ' ' },
    { ...valid, mode: 'other' },
    { ...valid, targetDurationSeconds: 14 },
    { ...valid, targetDurationSeconds: 61 },
    { ...valid, additionalContext: 'x'.repeat(1001) },
  ])('rejects malformed or out-of-range input', (input) => {
    expect(parseCustomPracticeInput(input)).toBeNull()
  })
  it('rejects malformed cookie data', () => expect(parseCustomPracticeCookie('%')).toBeNull())
  it.each([undefined, '0', 'true', ['1'], ['1', '1'], 1])(
    'does not activate a custom session for an invalid marker',
    (marker) => expect(isCustomPracticeMarker(marker)).toBe(false),
  )
  it('activates a custom session only for the singular action marker', () => {
    expect(isCustomPracticeMarker('1')).toBe(true)
    const action = readFileSync('src/actions/custom-practice.ts', 'utf8')
    const recordPage = readFileSync('src/app/(app)/record/page.tsx', 'utf8')
    expect(action).toContain("redirect('/record?custom=1')")
    expect(recordPage).toContain('if (!session && isCustomPracticeMarker(params.custom))')
    expect(recordPage).toContain('title="Your custom prompt is not available"')
    expect(recordPage.indexOf('isCustomPracticeMarker(params.custom)')).toBeLessThan(
      recordPage.indexOf('parseRecordPromptParam(params.prompt)'),
    )
  })
  it('keeps custom prompt transport out of the public prompt library', () => {
    expect(readFileSync('src/actions/custom-practice.ts', 'utf8')).not.toContain(".from('prompts')")
  })
})
