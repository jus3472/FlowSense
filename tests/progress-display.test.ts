import { describe, expect, it } from 'vitest'
import { PROGRESS_FILTERS, parseProgressFilter, progressFilterHref } from '@/lib/progress/display'

describe('progress filter display contract', () => {
  it('accepts All and every canonical current mode', () => {
    expect(PROGRESS_FILTERS).toEqual([
      'all',
      'practice',
      'interview',
      'presentation',
      'conversation',
      'custom',
      'other',
    ])
    expect(parseProgressFilter(undefined)).toEqual({ status: 'valid', filter: 'all' })
    for (const filter of PROGRESS_FILTERS.slice(1)) {
      expect(parseProgressFilter(filter)).toEqual({ status: 'valid', filter })
    }
  })

  it('rejects legacy and repeated query values', () => {
    expect(parseProgressFilter('free-practice')).toEqual({ status: 'invalid' })
    expect(parseProgressFilter(['interview', 'practice'])).toEqual({ status: 'invalid' })
  })

  it('uses a clean default URL and explicit canonical mode URLs', () => {
    expect(progressFilterHref('all')).toBe('/progress')
    expect(progressFilterHref('practice')).toBe('/progress?mode=practice')
    expect(progressFilterHref('interview')).toBe('/progress?mode=interview')
    expect(progressFilterHref('presentation')).toBe('/progress?mode=presentation')
    expect(progressFilterHref('conversation')).toBe('/progress?mode=conversation')
    expect(progressFilterHref('custom')).toBe('/progress?mode=custom')
    expect(progressFilterHref('other')).toBe('/progress?mode=other')
  })
})
