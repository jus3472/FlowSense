import { describe, expect, it } from 'vitest'
import {
  parsePracticeCategory,
  practiceCategoryFromMetrics,
  practiceModeForCategory,
} from '@/lib/practice/category'

describe('practice category contract', () => {
  it('keeps the four scoring modes unchanged and scores Other as General Speaking', () => {
    expect(practiceModeForCategory('interview')).toBe('interview')
    expect(practiceModeForCategory('presentation')).toBe('presentation')
    expect(practiceModeForCategory('conversation')).toBe('conversation')
    expect(practiceModeForCategory('practice')).toBe('practice')
    expect(practiceModeForCategory('other')).toBe('practice')
  })

  it('reads a consistent stored category and restricts Other to custom attempts', () => {
    const metrics = { practice: { category: 'other' } }
    expect(practiceCategoryFromMetrics(metrics, 'practice', 'custom')).toBe('other')
    expect(practiceCategoryFromMetrics(metrics, 'practice', 'library')).toBe('practice')
  })

  it('falls back to legacy mode for missing, invalid, or contradictory categories', () => {
    expect(practiceCategoryFromMetrics({}, 'interview', 'custom')).toBe('interview')
    expect(
      practiceCategoryFromMetrics(
        { practice: { category: 'conversation' } },
        'interview',
        'custom',
      ),
    ).toBe('interview')
    expect(practiceCategoryFromMetrics({ practice: { category: 'unknown' } }, 'practice')).toBe(
      'practice',
    )
    expect(practiceCategoryFromMetrics({}, 'unknown')).toBeNull()
    expect(parsePracticeCategory('unknown')).toBeNull()
  })
})
