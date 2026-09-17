import { describe, expect, it } from 'vitest'
import {
  COMPACT_PROGRESS_POINT_COUNT,
  PROGRESS_DIMENSION_IDS,
  aggregateV3Progress,
  performancePoints,
} from '@/lib/progress/v3-aggregation'
import { progressAttempt, v3Snapshot } from './helpers/result-snapshots'

const NOW = new Date('2026-09-05T12:00:00.000Z')

describe('current progress aggregation', () => {
  it('includes matching custom categories with tracks but separates Other from General', () => {
    const base = progressAttempt('library-general', '2026-09-04T12:00:00.000Z')
    const interview = progressAttempt(
      'library-interview',
      '2026-09-04T12:00:00.000Z',
      v3Snapshot({ mode: 'interview' }),
    )
    const attempts = [
      base,
      { ...base, id: 'legacy-custom', promptSource: 'custom' as const },
      { ...base, id: 'other-custom', promptSource: 'custom' as const, category: 'other' as const },
      interview,
      {
        ...interview,
        id: 'interview-custom',
        promptSource: 'custom' as const,
        category: 'interview' as const,
      },
      {
        ...interview,
        id: 'mismatched-category',
        promptSource: 'custom' as const,
        category: 'other' as const,
      },
    ]
    for (const [filter, ids] of [
      ['practice', ['legacy-custom', 'library-general']],
      ['interview', ['interview-custom', 'library-interview', 'mismatched-category']],
      ['custom', ['interview-custom', 'legacy-custom', 'mismatched-category', 'other-custom']],
      ['other', ['other-custom']],
    ] as const) {
      const result = aggregateV3Progress(attempts, { now: NOW, filter })
      expect(result.overall.points.map((point) => point.attemptId)).toEqual(ids)
      expect(result.metrics.pace.points).toHaveLength(ids.length)
    }
    expect(aggregateV3Progress(attempts, { now: NOW }).overall.points).toHaveLength(6)
  })

  it('exposes the exact overview and ten-metric dimension order', () => {
    const result = aggregateV3Progress([progressAttempt('attempt', '2026-09-04T12:00:00.000Z')], {
      now: NOW,
    })

    expect(result.dimensionIds).toEqual(PROGRESS_DIMENSION_IDS)
    expect(result.dimensionIds).toEqual([
      'overall',
      'what_you_said',
      'how_you_sounded',
      'answered_prompt',
      'specificity',
      'structure',
      'conciseness',
      'word_choice',
      'grammar',
      'pace',
      'paused_time',
      'articulation',
      'energy',
    ])
    expect(result.overall.observationCount).toBe(1)
    expect(result.sections.what_you_said.observationCount).toBe(1)
    expect(result.sections.how_you_sounded.observationCount).toBe(1)
  })

  it('uses normalized components across mode-specific weights and preserves raw context', () => {
    const result = aggregateV3Progress(
      [
        progressAttempt(
          'practice',
          '2026-09-03T12:00:00.000Z',
          v3Snapshot({
            mode: 'practice',
            component: 0.74,
            evidenceMetric: 'grammar',
            measurements: { semantic_component: 0.8 },
          }),
        ),
        progressAttempt(
          'interview',
          '2026-09-04T12:00:00.000Z',
          v3Snapshot({ mode: 'interview', component: 0.74 }),
        ),
      ],
      { now: NOW },
    )

    expect(result.metrics.grammar.points.map((point) => point.value)).toEqual([74, 74])
    expect(
      result.metrics.grammar.points.map((point) => [point.earnedPoints, point.maxPoints]),
    ).toEqual([
      [5, 7],
      [4, 5],
    ])
    expect(result.metrics.grammar.points[0]?.raw).toEqual({
      component: 0.74,
      measurements: { semantic_component: 0.8 },
    })
    expect(result.sections.what_you_said.points[0]?.value).toBe(
      (result.sections.what_you_said.points[0]!.earnedPoints / 50) * 100,
    )
  })

  it('plots stored overall points directly and normalizes stored section points out of 50', () => {
    const overall = v3Snapshot({ component: 0.84, components: { articulation: 0.8 } })
    const section = v3Snapshot({ component: 0.9, components: { specificity: 0.95 } })
    const result = aggregateV3Progress(
      [
        progressAttempt('overall-84', '2026-09-03T12:00:00.000Z', overall),
        progressAttempt('section-45', '2026-09-04T12:00:00.000Z', section),
      ],
      { now: NOW },
    )

    expect(overall.total_earned_points).toBe(84)
    expect(result.overall.points[0]?.value).toBe(84)
    expect(section.sections.what_you_said.earned_points).toBe(45)
    expect(result.sections.what_you_said.points[1]).toMatchObject({
      value: 90,
      earnedPoints: 45,
      maxPoints: 50,
    })
  })

  it('keeps scored partial metrics without inventing unavailable totals or sections', () => {
    const result = aggregateV3Progress(
      [
        progressAttempt(
          'partial',
          '2026-09-04T12:00:00.000Z',
          v3Snapshot({ unavailableMetric: 'energy' }),
        ),
      ],
      { now: NOW },
    )

    expect(result.counts).toMatchObject({ included: 1, complete: 0, partial: 1 })
    expect(result.overall.points).toEqual([])
    expect(result.sections.what_you_said.observationCount).toBe(1)
    expect(result.sections.how_you_sounded.points).toEqual([])
    expect(result.metrics.pace.observationCount).toBe(1)
    expect(result.metrics.energy.points).toEqual([])
  })

  it('filters strict current snapshots and requires scalar metadata agreement', () => {
    const current = v3Snapshot()
    const result = aggregateV3Progress(
      [
        progressAttempt('included', '2026-09-04T12:00:00.000Z', current),
        progressAttempt('old', '2026-09-04T13:00:00.000Z', { ...current, version: 'v3.score.1' }),
        progressAttempt('future-version', '2026-09-04T14:00:00.000Z', {
          ...current,
          version: 'v3.score.99',
        }),
        progressAttempt('malformed', '2026-09-04T15:00:00.000Z', {}),
        progressAttempt('no-snapshot', '2026-09-04T16:00:00.000Z', null),
        progressAttempt('future-time', '2026-09-06T12:00:00.000Z', current),
        progressAttempt('wrong-rubric', '2026-09-04T17:00:00.000Z', current, null, {
          rubricVersion: 'v2',
        }),
        progressAttempt('wrong-mode', '2026-09-04T18:00:00.000Z', current, null, {
          practiceMode: 'interview',
        }),
        progressAttempt('wrong-score', '2026-09-04T19:00:00.000Z', current, null, {
          score: 1,
        }),
      ],
      { now: NOW },
    )

    expect(result.counts).toEqual({
      input: 9,
      included: 1,
      complete: 1,
      partial: 0,
      malformed: 2,
      unsupportedVersion: 2,
      metadataMismatch: 3,
      invalidTimestamp: 1,
      excludedMode: 0,
    })
  })

  it('includes custom prompts only under their agreeing canonical mode', () => {
    const interview = v3Snapshot({ mode: 'interview' })
    const custom = progressAttempt('custom', '2026-09-04T12:00:00.000Z', interview, null, {
      practiceMode: 'interview',
      promptSource: 'custom',
    })
    const mismatched = progressAttempt('mismatch', '2026-09-04T13:00:00.000Z', interview, null, {
      practiceMode: 'practice',
      promptSource: 'custom',
    })

    expect(aggregateV3Progress([custom, mismatched], { now: NOW }).counts).toMatchObject({
      included: 1,
      metadataMismatch: 1,
    })
    expect(aggregateV3Progress([custom], { now: NOW, filter: 'interview' }).counts.included).toBe(1)
    expect(aggregateV3Progress([custom], { now: NOW, filter: 'practice' }).counts).toMatchObject({
      included: 0,
      excludedMode: 1,
    })
  })

  it.each(['practice', 'interview', 'presentation', 'conversation'] as const)(
    'keeps every %s attempt, including retries, and excludes unrelated modes',
    (filter) => {
      const matching = v3Snapshot({ mode: filter })
      const otherMode = filter === 'practice' ? 'interview' : 'practice'
      const unrelated = v3Snapshot({ mode: otherMode })
      const result = aggregateV3Progress(
        [
          progressAttempt('first', '2026-09-01T12:00:00.000Z', matching, null),
          progressAttempt('retry', '2026-09-02T12:00:00.000Z', matching, 'first'),
          progressAttempt('unrelated', '2026-09-03T12:00:00.000Z', unrelated, null),
        ],
        { now: NOW, filter },
      )

      expect(result.counts).toMatchObject({ included: 2, excludedMode: 1 })
      expect(result.overall.points.map((point) => point.attemptId)).toEqual(['first', 'retry'])
      expect(result.overall.points[1]?.retryOfAttemptId).toBe('first')
    },
  )

  it('orders by finished time then id and centralizes compact last-ten selection', () => {
    const input = Array.from({ length: 12 }, (_, index) =>
      progressAttempt(
        `attempt-${String(11 - index).padStart(2, '0')}`,
        index < 2
          ? '2026-08-20T12:00:00.000Z'
          : `2026-08-${String(19 + index).padStart(2, '0')}T12:00:00.000Z`,
      ),
    )
    const result = aggregateV3Progress(input, { now: NOW })
    const expanded = performancePoints(result.overall, 'expanded')
    const compact = performancePoints(result.overall, 'compact')

    expect(expanded).toHaveLength(12)
    expect(expanded.slice(0, 2).map((point) => point.attemptId)).toEqual([
      'attempt-10',
      'attempt-11',
    ])
    expect(compact).toHaveLength(COMPACT_PROGRESS_POINT_COUNT)
    expect(compact).toEqual(expanded.slice(-COMPACT_PROGRESS_POINT_COUNT))
    expect(result.overall.points).toHaveLength(12)
  })
})
