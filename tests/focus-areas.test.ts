import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  defaultPracticeMode,
  FOCUS_AREAS,
  isFocusAreaId,
  practiceModePriority,
  sanitizeFocusAreas,
} from '@/lib/focus-areas'

describe('practice goals', () => {
  it('offers the six canonical goals onboarding shows', () => {
    expect(FOCUS_AREAS).toHaveLength(6)
    expect(FOCUS_AREAS.map((area) => area.label)).toEqual([
      'Interviews',
      'Presentations',
      'Meetings and conversations',
      'Difficult conversations',
      'Speaking on the spot',
      'General speaking ability',
    ])
  })

  it('recognises a known id', () => {
    expect(isFocusAreaId('interviews')).toBe(true)
    expect(isFocusAreaId('karaoke')).toBe(false)
  })

  it('drops unknown values and duplicates', () => {
    expect(sanitizeFocusAreas(['interviews', 'karaoke', 'interviews'])).toEqual(['interviews'])
  })

  it('returns areas in a stable order regardless of input order', () => {
    expect(
      sanitizeFocusAreas([
        'class',
        'confidence',
        'meetings',
        'interviews',
        'speaking-english',
        'difficult-conversations',
        'presentations',
        'unknown',
        'meetings',
      ]),
    ).toEqual([
      'interviews',
      'presentations',
      'meetings-conversations',
      'difficult-conversations',
      'speaking-on-the-spot',
      'general-speaking',
    ])
  })

  it('derives deterministic default and prompt priorities with a neutral fallback', () => {
    expect(defaultPracticeMode(['presentations', 'interviews'])).toBe('interview')
    expect(defaultPracticeMode([])).toBe('practice')
    expect(practiceModePriority(['meetings', 'presentations'])).toEqual([
      'presentation',
      'conversation',
      'practice',
    ])
  })
  it('keeps practice preferences out of scoring modules', () => {
    for (const file of ['src/lib/scoring/assemble.ts', 'src/lib/scoring/v2/assemble.ts']) {
      expect(readFileSync(file, 'utf8')).not.toContain('focus-areas')
    }
  })
})
