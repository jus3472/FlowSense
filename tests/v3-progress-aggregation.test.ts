import { describe, expect, it } from 'vitest'
import { aggregateV3Progress } from '@/lib/progress/v3-aggregation'
import { progressAttempt, v3Snapshot } from './helpers/result-snapshots'

const NOW = new Date('2026-09-05T12:00:00.000Z')

describe('current progress aggregation', () => {
  it('aggregates only current v3.2 snapshots across current metrics', () => {
    const result = aggregateV3Progress(
      [
        progressAttempt('a', '2026-09-03T12:00:00.000Z', v3Snapshot({ component: 0.6 })),
        progressAttempt('b', '2026-09-04T12:00:00.000Z', v3Snapshot({ component: 0.8 })),
      ],
      { now: NOW },
    )
    expect(result.counts.included).toBe(2)
    expect(result.metricIds).toHaveLength(10)
    expect(result.windows.all.overall.points.map((point) => point.attemptId)).toEqual(['a', 'b'])
    expect(result.windows.all.metrics.energy.averageValue).toBe(70)
  })

  it('filters by mode and excludes old, future, malformed, resultless, and future-dated rows', () => {
    const current = v3Snapshot()
    const result = aggregateV3Progress(
      [
        progressAttempt('practice', '2026-09-04T12:00:00.000Z', current),
        progressAttempt('interview', '2026-09-04T13:00:00.000Z', v3Snapshot({ mode: 'interview' })),
        progressAttempt('old', '2026-09-04T14:00:00.000Z', { ...current, version: 'v3.score.1' }),
        progressAttempt('future', '2026-09-04T15:00:00.000Z', { ...current, version: 'v3.score.99' }),
        progressAttempt('malformed', '2026-09-04T16:00:00.000Z', {}),
        progressAttempt('none', '2026-09-04T17:00:00.000Z', null),
        progressAttempt('later', '2026-09-06T12:00:00.000Z', current),
      ],
      { now: NOW, mode: 'practice' },
    )
    expect(result.counts).toMatchObject({
      input: 7,
      validV3: 2,
      included: 1,
      incomplete: 1,
      malformed: 2,
      unsupportedVersion: 2,
      excludedMode: 1,
    })
  })

  it('keeps unavailable metrics out of their series without inventing zeroes', () => {
    const result = aggregateV3Progress(
      [progressAttempt('neutral', '2026-09-04T12:00:00.000Z', v3Snapshot({ unavailableMetric: 'energy' }))],
      { now: NOW },
    )
    expect(result.windows.all.overall.valueCount).toBe(0)
    expect(result.windows.all.metrics.energy.valueCount).toBe(0)
    expect(result.windows.all.metrics.pace.valueCount).toBe(1)
  })
})
