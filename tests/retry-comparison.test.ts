import { describe, expect, it, vi } from 'vitest'
import {
  compareV3RetryResults,
  loadRetryAncestorChain,
} from '@/lib/results/retry-comparison'
import { v3Snapshot } from './helpers/result-snapshots'

describe('current retry comparison', () => {
  it('compares exact current score/rubric/mode snapshots', () => {
    const comparison = compareV3RetryResults(
      v3Snapshot({ component: 0.9 }),
      v3Snapshot({ component: 0.7 }),
    )
    expect(comparison?.rows[0]).toMatchObject({ category: 'overall', deltaPoints: 20 })
    expect(comparison?.rows).toHaveLength(11)
  })

  it('rejects missing, different-mode, and incompatible parents', () => {
    const current = v3Snapshot()
    expect(compareV3RetryResults(current, null)).toBeNull()
    expect(compareV3RetryResults(current, v3Snapshot({ mode: 'interview' }))).toBeNull()
    expect(
      compareV3RetryResults(current, {
        ...v3Snapshot(),
        version: 'v3.score.1',
      } as unknown as typeof current),
    ).toBeNull()
  })

  it('loads a bounded owned ancestor chain and fails closed for deleted links and cycles', async () => {
    const rows = new Map([
      ['current', { id: 'current', retryOfAttemptId: 'parent' }],
      ['parent', { id: 'parent', retryOfAttemptId: null }],
    ])
    const load = vi.fn(async (id: string) => rows.get(id) ?? null)
    expect(await loadRetryAncestorChain('current', load)).toEqual([
      { id: 'parent', retryOfAttemptId: null },
    ])
    rows.delete('parent')
    expect(await loadRetryAncestorChain('current', load)).toBeNull()
    rows.set('parent', { id: 'parent', retryOfAttemptId: 'current' })
    expect(await loadRetryAncestorChain('current', load)).toBeNull()
  })
})
