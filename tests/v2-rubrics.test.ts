import { PRACTICE_MODES, SKILL_CATEGORIES } from '@/lib/practice/contracts'
import type { CheckScoreResult } from '@/lib/scoring/v2/contracts'
import { MODE_RUBRICS, rubricFor } from '@/lib/scoring/v2/rubrics'
import { describe, expect, it } from 'vitest'

describe('v2 mode rubrics', () => {
  it('defines a valid 100-point rubric for every practice mode', () => {
    expect(Object.keys(MODE_RUBRICS).sort()).toEqual([...PRACTICE_MODES].sort())

    for (const mode of PRACTICE_MODES) {
      const rubric = rubricFor(mode)
      expect(rubric.mode).toBe(mode)
      expect(rubric.version).toBe('v2')
      expect(
        Object.values(rubric.categories).reduce((total, category) => total + category.weight, 0),
      ).toBe(100)
    }
  })

  it('keeps every required category and stable category name in each rubric', () => {
    for (const mode of PRACTICE_MODES) {
      const rubric = rubricFor(mode)
      expect(Object.keys(rubric.categories).sort()).toEqual([...SKILL_CATEGORIES].sort())
      expect(rubric.checks).toEqual(
        expect.arrayContaining(
          SKILL_CATEGORIES.map((category) =>
            expect.objectContaining({ category, availability: 'available' }),
          ),
        ),
      )
    }
  })

  it('models mode-specific unavailable checks without assigning a score', () => {
    const check = rubricFor('conversation').checks.find((item) => item.id === 'fluency.turn_taking')
    expect(check).toMatchObject({ availability: 'unavailable', optional: true })

    const result: CheckScoreResult = {
      availability: 'unavailable',
      status: 'unavailable',
      earned_points: null,
      max_points: null,
      explanation: null,
      evidence: [],
    }
    expect(result.earned_points).toBeNull()
    expect(result.max_points).toBeNull()
  })

  it('distinguishes an available check that was not checked from an unavailable one', () => {
    const result: CheckScoreResult = {
      availability: 'available',
      status: 'not_checked',
      earned_points: null,
      max_points: 12,
      explanation: null,
      evidence: [],
    }
    expect(result.status).toBe('not_checked')
    expect(result.max_points).toBe(12)
  })
})
