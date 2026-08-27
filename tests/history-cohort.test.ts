import { describe, expect, it } from 'vitest'
import {
  readHistoryStoredResult,
  summarizeHistoryScoreCohort,
  type HistoryScoreInput,
} from '@/lib/results/history-cohort'
import { legacySectionSnapshot, v2Snapshot } from './helpers/result-snapshots'

function input(
  id: string,
  createdAt: string,
  sectionScores: unknown,
  score: number | null = 70,
): HistoryScoreInput {
  return { id, createdAt, score, sectionScores, practiceMode: 'practice' }
}

describe('History score cohorts', () => {
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
  })

  it('selects the newest supported scored cohort deterministically and excludes other modes', () => {
    const summary = summarizeHistoryScoreCohort(
      [
        input('practice-a', '2026-08-27T00:00:02.000Z', v2Snapshot({ component: 0.6 })),
        input('practice-b', '2026-08-27T00:00:03.000Z', v2Snapshot({ component: 0.8 })),
        {
          ...input(
            'interview',
            '2026-08-27T00:00:01.000Z',
            v2Snapshot({ mode: 'interview', component: 1 }),
          ),
          practiceMode: 'interview',
        },
        input(
          'mismatched-mode',
          '2026-08-27T00:00:04.500Z',
          v2Snapshot({ mode: 'conversation', component: 1 }),
          100,
        ),
        input(
          'unsupported-newest',
          '2026-08-27T00:00:05.000Z',
          { ...v2Snapshot(), version: 'future.score.1' },
          100,
        ),
        input(
          'partial-newer',
          '2026-08-27T00:00:04.000Z',
          v2Snapshot({ unavailableCategory: 'clarity' }),
          100,
        ),
        input('legacy', '2026-08-26T00:00:00.000Z', legacySectionSnapshot, 95),
      ],
      { scanLimit: 200, truncated: false },
    )

    expect(summary.cohort).toMatchObject({ kind: 'v2', mode: 'practice' })
    expect(summary.points.map((point) => [point.attemptId, point.value])).toEqual([
      ['practice-a', 60],
      ['practice-b', 81],
    ])
    expect(summary.average).toBe(70.5)
    expect(summary.excludedCount).toBe(5)
  })

  it('uses stable id ordering when timestamps tie and reports bounded coverage', () => {
    const summary = summarizeHistoryScoreCohort(
      [
        input('a', '2026-08-27T00:00:00.000Z', legacySectionSnapshot, 60),
        {
          ...input('b', '2026-08-27T00:00:00.000Z', v2Snapshot({ mode: 'conversation' }), 80),
          practiceMode: 'conversation',
        },
      ],
      { scanLimit: 2, truncated: true },
    )

    expect(summary.cohort).toMatchObject({ kind: 'v2', mode: 'conversation' })
    expect(summary.points.map((point) => point.attemptId)).toEqual(['b'])
    expect(summary).toMatchObject({ scannedCount: 2, excludedCount: 1, truncated: true })
  })

  it('compares legacy snapshots across stored display modes as one score generation', () => {
    const summary = summarizeHistoryScoreCohort(
      [
        {
          ...input('null-mode', '2026-08-27T00:00:01.000Z', legacySectionSnapshot, 60),
          practiceMode: null,
        },
        input('practice-mode', '2026-08-27T00:00:02.000Z', legacySectionSnapshot, 70),
        {
          ...input('interview-mode', '2026-08-27T00:00:03.000Z', legacySectionSnapshot, 80),
          practiceMode: 'interview',
        },
      ],
      { scanLimit: 200, truncated: false },
    )

    expect(summary.cohort).toEqual({ kind: 'legacy' })
    expect(summary.points.map((point) => [point.attemptId, point.value])).toEqual([
      ['null-mode', 60],
      ['practice-mode', 70],
      ['interview-mode', 80],
    ])
    expect(summary.average).toBe(70)
  })
})
