import { describe, expect, it } from 'vitest'
import { FOCUS_AREAS, focusPhrase, isFocusAreaId, sanitizeFocusAreas } from '@/lib/focus-areas'

describe('focus areas', () => {
  it('offers the 7 areas onboarding shows', () => {
    expect(FOCUS_AREAS).toHaveLength(7)
  })

  it('recognises a known id', () => {
    expect(isFocusAreaId('interviews')).toBe(true)
    expect(isFocusAreaId('karaoke')).toBe(false)
  })

  it('drops unknown values and duplicates', () => {
    expect(sanitizeFocusAreas(['interviews', 'karaoke', 'interviews'])).toEqual(['interviews'])
  })

  it('returns areas in a stable order regardless of input order', () => {
    expect(sanitizeFocusAreas(['confidence', 'interviews'])).toEqual(['interviews', 'confidence'])
  })

  it('builds empty state copy from the first selected area', () => {
    expect(focusPhrase(['meetings'])).toBe('in meetings')
  })

  it('falls back when nothing is selected', () => {
    expect(focusPhrase([])).toBe('under pressure')
  })
})
