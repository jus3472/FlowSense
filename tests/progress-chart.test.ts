import { describe, expect, it } from 'vitest'
import { progressChartCoordinates, progressChartPath } from '@/lib/progress/chart'
import type { ProgressPoint } from '@/lib/progress/v3-aggregation'

function point(attemptId: string, value: number): ProgressPoint {
  return {
    attemptId,
    finishedAt: '2026-09-05T12:00:00.000Z',
    mode: 'practice',
    promptText: attemptId,
    retryOfAttemptId: null,
    value,
    valueOutOf: 100,
    earnedPoints: value,
    maxPoints: 100,
    raw: null,
  }
}

describe('progress chart geometry', () => {
  it('keeps the fixed 0-100 scale for the full chart history', () => {
    const coordinates = progressChartCoordinates([
      point('zero', 0),
      point('middle', 50),
      point('full', 100),
    ])

    expect(coordinates).toEqual([
      { attemptId: 'zero', x: 6, y: 66, value: 0 },
      { attemptId: 'middle', x: 120, y: 36, value: 50 },
      { attemptId: 'full', x: 234, y: 6, value: 100 },
    ])
    expect(progressChartPath(coordinates)).toBe('M 6 66 L 120 36 L 234 6')
  })

  it('centers one observation without inventing a line', () => {
    const coordinates = progressChartCoordinates([point('only', 72)])

    expect(coordinates).toEqual([{ attemptId: 'only', x: 120, y: 22.8, value: 72 }])
    expect(progressChartPath(coordinates)).toBe('M 120 22.8')
  })

  it('returns empty finite geometry for absent or invalid values', () => {
    expect(progressChartCoordinates([])).toEqual([])
    expect(progressChartCoordinates([point('negative', -1), point('large', 101)])).toEqual([])
    expect(progressChartPath([])).toBe('')
  })
})
