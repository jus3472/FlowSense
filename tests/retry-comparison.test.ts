import { compareRetryResults, retryAncestorIds } from '@/lib/results/retry-comparison'
import { V2_SCORE_PAYLOAD_VERSION, type V2ScorePayload } from '@/lib/scoring/v2/assemble'
import { describe, expect, it } from 'vitest'

function score(overrides: Partial<V2ScorePayload> = {}): V2ScorePayload {
  const categories = Object.fromEntries(
    [
      ['fluency', 22],
      ['clarity', 20],
      ['vocabulary', 12],
      ['grammar', 12],
      ['structure', 18],
      ['delivery', 16],
    ].map(([category, max]) => [
      category,
      {
        category,
        availability: 'available',
        status: 'scored',
        component: 1,
        earned_points: max,
        max_points: max,
        measurements: {},
        evidence: [],
        deductions: [],
        warnings: [],
      },
    ]),
  ) as V2ScorePayload['categories']
  return {
    version: V2_SCORE_PAYLOAD_VERSION,
    rubric_version: 'v2',
    mode: 'practice',
    total_earned_points: 100,
    total_max_points: 100,
    categories,
    warnings: [],
    ...overrides,
  }
}

describe('retry comparison', () => {
  it('returns numeric direct-parent rows beyond a conservative noise threshold', () => {
    const current = score()
    const previous = score({
      categories: {
        ...current.categories,
        fluency: { ...current.categories.fluency, component: 0.7, earned_points: 15 },
      },
      total_earned_points: 93,
    })
    expect(compareRetryResults('current', 'previous', current, previous)).toMatchObject({
      previousAttemptId: 'previous',
      rows: [{ category: 'fluency', currentPoints: 22, previousPoints: 15, deltaPoints: 7 }],
    })
  })

  it('omits small differences and partial categories without making a claim', () => {
    const current = score()
    const previous = score({
      categories: {
        ...current.categories,
        fluency: { ...current.categories.fluency, component: 0.91, earned_points: 20 },
        grammar: {
          ...current.categories.grammar,
          status: 'not_checked',
          component: null,
          earned_points: null,
        },
      },
      total_earned_points: null,
    })
    expect(compareRetryResults('current', 'previous', current, previous)?.rows).toEqual([])
  })

  it('rejects incompatible mode, rubric, and category maxima', () => {
    const current = score()
    expect(
      compareRetryResults('current', 'previous', current, score({ mode: 'interview' })),
    ).toBeNull()
    expect(
      compareRetryResults('current', 'previous', current, {
        ...score(),
        rubric_version: 'other' as 'v2',
      }),
    ).toBeNull()
    expect(
      compareRetryResults(
        'current',
        'previous',
        current,
        score({
          categories: {
            ...current.categories,
            fluency: { ...current.categories.fluency, max_points: 23 },
          },
        }),
      ),
    ).toBeNull()
  })

  it('bounds chain traversal and rejects missing or cyclic parents', () => {
    expect(
      retryAncestorIds('a', [
        { id: 'a', retryOfAttemptId: 'b' },
        { id: 'b', retryOfAttemptId: null },
      ]),
    ).toEqual(['b'])
    expect(retryAncestorIds('a', [{ id: 'a', retryOfAttemptId: 'missing' }])).toBeNull()
    expect(
      retryAncestorIds('a', [
        { id: 'a', retryOfAttemptId: 'b' },
        { id: 'b', retryOfAttemptId: 'a' },
      ]),
    ).toBeNull()
    expect(retryAncestorIds('a', [{ id: 'a', retryOfAttemptId: 42 as never }])).toBeNull()
    const longChain = Array.from({ length: 10 }, (_, index) => ({
      id: `node-${index}`,
      retryOfAttemptId: index === 9 ? null : `node-${index + 1}`,
    }))
    expect(retryAncestorIds('node-0', longChain)).toBeNull()
  })
})
