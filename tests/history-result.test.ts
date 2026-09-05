import { describe, expect, it } from 'vitest'
import { readHistoryStoredResult } from '@/lib/results/history-result'
import { v3Snapshot } from './helpers/result-snapshots'

describe('History stored results', () => {
  it('uses validated stored totals and identifies unsupported or partial rows without recalculation', () => {
    expect(readHistoryStoredResult({ ...v3Snapshot(), version: 'future.score.1' }, 91)).toEqual({
      kind: 'unsupported',
      score: null,
    })
    const v3 = v3Snapshot({ component: 0.8 })
    expect(readHistoryStoredResult(v3, v3.total_earned_points)).toEqual({
      kind: 'current',
      score: v3.total_earned_points,
    })
    expect(readHistoryStoredResult(v3, 12)).toEqual({
      kind: 'current',
      score: v3.total_earned_points,
    })
    expect(
      readHistoryStoredResult(v3Snapshot({ unavailableMetric: 'articulation' }), null),
    ).toEqual({ kind: 'partial', score: null })
  })
})
