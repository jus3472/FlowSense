import {
  compareRetryResults,
  loadRetryAncestorChain,
  RETRY_COMPARISON_NOISE_POINTS,
} from '@/lib/results/retry-comparison'
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
  it('returns overall and every mutually scored category with neutral numeric metadata', () => {
    const current = score()
    const previous = score({
      categories: {
        ...current.categories,
        fluency: { ...current.categories.fluency, component: 0.7, earned_points: 15 },
      },
      total_earned_points: 93,
    })
    const comparison = compareRetryResults(current, previous)
    expect(comparison?.rows).toHaveLength(7)
    expect(comparison?.rows[0]).toMatchObject({
      category: 'overall',
      label: 'Overall',
      previousPoints: 93,
      currentPoints: 100,
      withinNoise: false,
    })
    expect(comparison?.rows).toContainEqual(
      expect.objectContaining({
        category: 'fluency',
        label: 'Fluency',
        previousPoints: 15,
        currentPoints: 22,
      }),
    )
  })

  it('keeps zero and small deltas while omitting only categories not scored on both attempts', () => {
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
    const rows = compareRetryResults(current, previous)?.rows ?? []
    expect(rows.find((row) => row.category === 'overall')).toBeUndefined()
    expect(rows.find((row) => row.category === 'grammar')).toBeUndefined()
    expect(rows.find((row) => row.category === 'fluency')).toMatchObject({
      deltaPoints: 2,
      withinNoise: true,
    })
    expect(RETRY_COMPARISON_NOISE_POINTS).toBe(2)
  })

  it('rejects incompatible mode, rubric, and category maxima', () => {
    const current = score()
    expect(compareRetryResults(current, score({ mode: 'interview' }))).toBeNull()
    expect(
      compareRetryResults(current, {
        ...score(),
        rubric_version: 'other' as 'v2',
      }),
    ).toBeNull()
    expect(
      compareRetryResults(
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

  it('bounds the exact loaded chain and rejects missing, malformed, or cyclic parents', async () => {
    const calls: string[] = []
    const loader = async (id: string) => {
      calls.push(id)
      return (
        {
          a: { id: 'a', retryOfAttemptId: 'b' },
          b: { id: 'b', retryOfAttemptId: 'c' },
          c: { id: 'c', retryOfAttemptId: null },
        }[id] ?? null
      )
    }
    await expect(loadRetryAncestorChain('a', loader)).resolves.toEqual([
      { id: 'b', retryOfAttemptId: 'c' },
      { id: 'c', retryOfAttemptId: null },
    ])
    expect(calls).toEqual(['a', 'b', 'c'])
    await expect(loadRetryAncestorChain('a', async () => null)).resolves.toBeNull()
    await expect(
      loadRetryAncestorChain('a', async (id) => ({ id, retryOfAttemptId: id === 'a' ? 'b' : 'a' })),
    ).resolves.toBeNull()
    await expect(
      loadRetryAncestorChain('a', async () => ({ id: 'a', retryOfAttemptId: 42 as never })),
    ).resolves.toBeNull()
    const longChain = Array.from({ length: 10 }, (_, index) => ({
      id: `node-${index}`,
      retryOfAttemptId: index === 9 ? null : `node-${index + 1}`,
    }))
    await expect(
      loadRetryAncestorChain(
        'node-0',
        async (id) => longChain.find((node) => node.id === id) ?? null,
      ),
    ).resolves.toBeNull()
  })
})
