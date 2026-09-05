import { describe, expect, it } from 'vitest'
import { readHistoryStoredResult } from '@/lib/results/history-cohort'
import { legacySectionSnapshot, v2Snapshot, v3Snapshot } from './helpers/result-snapshots'

describe('History stored results', () => {
  it('uses validated stored totals and identifies unsupported or partial rows without recalculation', () => {
    expect(readHistoryStoredResult(v2Snapshot({ component: 0.8 }), 12)).toEqual({
      kind: 'v2',
      score: 81,
    })
    expect(readHistoryStoredResult(v2Snapshot({ notCheckedCategory: 'grammar' }), 100)).toEqual({
      kind: 'partial',
      score: null,
    })
    expect(readHistoryStoredResult({ ...v2Snapshot(), version: 'future.score.1' }, 91)).toEqual({
      kind: 'unsupported',
      score: null,
    })
    expect(readHistoryStoredResult(legacySectionSnapshot, 73)).toEqual({
      kind: 'legacy',
      score: 73,
    })
    const v3 = v3Snapshot({ component: 0.8 })
    expect(readHistoryStoredResult(v3, v3.total_earned_points)).toEqual({
      kind: 'v3',
      score: v3.total_earned_points,
    })
    expect(readHistoryStoredResult(v3, 12)).toEqual({
      kind: 'v3',
      score: v3.total_earned_points,
    })
    expect(
      readHistoryStoredResult(v3Snapshot({ unavailableMetric: 'articulation' }), null),
    ).toEqual({ kind: 'partial', score: null })
  })
})
