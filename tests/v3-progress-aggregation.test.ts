import { describe, expect, it } from 'vitest'
import { aggregateV2Progress } from '@/lib/progress/aggregation'
import { aggregateV3Progress } from '@/lib/progress/v3-aggregation'
import { V3_METRIC_IDS } from '@/lib/scoring/v3/contracts'
import {
  legacySectionSnapshot,
  legacyV3Snapshot,
  progressAttempt,
  v2Snapshot,
  v3Snapshot,
} from './helpers/result-snapshots'

const NOW = new Date('2026-08-26T12:00:00.000Z')

describe('v3 progress aggregation', () => {
  it('builds only the exact v3 metric series and retains earlier cohorts as separate counts', () => {
    const result = aggregateV3Progress(
      [
        progressAttempt('earlier-v3', '2026-08-24T12:00:00.000Z', v3Snapshot({ component: 0.4 })),
        progressAttempt('later-v3', '2026-08-25T12:00:00.000Z', v3Snapshot({ component: 0.8 })),
        progressAttempt('legacy-v3', '2026-08-23T18:00:00.000Z', legacyV3Snapshot()),
        progressAttempt('v2', '2026-08-23T12:00:00.000Z', v2Snapshot()),
        progressAttempt('legacy', '2026-08-22T12:00:00.000Z', legacySectionSnapshot),
      ],
      { now: NOW },
    )

    expect(result.cohort).toEqual({ scoreVersion: 'v3.score.2', rubricVersion: 'v3' })
    expect(result.counts).toMatchObject({
      validV3: 3,
      selectedCohort: 2,
      earlierV2: 1,
      legacy: 1,
    })
    expect(result.counts.excludedIncompatible).toBe(3)
    expect(result.metricIds).toEqual(V3_METRIC_IDS)
    expect(result.windows.all.metrics.time_to_first_word.points).toEqual([])
    expect(result.windows.all.overall.points.map((point) => point.attemptId)).toEqual([
      'earlier-v3',
      'later-v3',
    ])
    for (const metric of V3_METRIC_IDS) {
      expect(result.windows.all.metrics[metric].points.map((point) => point.value)).toEqual([
        40, 80,
      ])
    }

    const earlier = aggregateV2Progress(
      [
        progressAttempt('v3', '2026-08-25T12:00:00.000Z', v3Snapshot()),
        progressAttempt('v2', '2026-08-24T12:00:00.000Z', v2Snapshot()),
      ],
      { now: NOW },
    )
    expect(earlier.counts).toMatchObject({ selectedCohort: 1, otherSupported: 1 })
    expect(earlier.windows.all.overall.points.map((point) => point.attemptId)).toEqual(['v2'])
  })

  it('keeps partial metric values but never fabricates an overall or unavailable metric point', () => {
    const result = aggregateV3Progress(
      [
        progressAttempt(
          'partial',
          '2026-08-25T12:00:00.000Z',
          v3Snapshot({ unavailableMetric: 'energy' }),
        ),
      ],
      { now: NOW },
    )

    expect(result.windows.all.attemptCount).toBe(1)
    expect(result.windows.all.overall.points).toEqual([])
    expect(result.windows.all.metrics.energy.points).toEqual([])
    expect(result.windows.all.metrics.grammar.points).toHaveLength(1)
  })

  it('applies the requested mode without admitting another mode into the selected series', () => {
    const result = aggregateV3Progress(
      [
        progressAttempt('practice', '2026-08-25T12:00:00.000Z', v3Snapshot({ mode: 'practice' })),
        progressAttempt('interview', '2026-08-24T12:00:00.000Z', v3Snapshot({ mode: 'interview' })),
      ],
      { now: NOW, mode: 'interview' },
    )

    expect(result.counts).toMatchObject({ validV3: 2, selectedCohort: 1, excludedMode: 1 })
    expect(result.windows.all.overall.points.map((point) => point.attemptId)).toEqual(['interview'])
  })

  it('retains the historical first-word series when v3.score.1 is the selected cohort', () => {
    const result = aggregateV3Progress(
      [
        progressAttempt(
          'legacy-a',
          '2026-08-24T12:00:00.000Z',
          legacyV3Snapshot({ component: 0.4 }),
        ),
        progressAttempt(
          'legacy-b',
          '2026-08-25T12:00:00.000Z',
          legacyV3Snapshot({ component: 0.8 }),
        ),
      ],
      { now: NOW },
    )

    expect(result.cohort?.scoreVersion).toBe('v3.score.1')
    expect(result.metricIds).toContain('time_to_first_word')
    expect(
      result.windows.all.metrics.time_to_first_word.points.map((point) => point.value),
    ).toEqual([40, 80])
  })
})
