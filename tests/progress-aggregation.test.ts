import { describe, expect, it } from 'vitest'
import { SKILL_CATEGORIES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import {
  LONGER_HISTORY_WINDOW_DAYS,
  RECENT_PROGRESS_WINDOW_DAYS,
  aggregateV2Progress,
  type ProgressAttemptInput,
} from '@/lib/progress/aggregation'
import { V2_SCORE_PAYLOAD_VERSION, type V2ScorePayload } from '@/lib/scoring/v2/assemble'
import { rubricFor } from '@/lib/scoring/v2/rubrics'

const NOW = new Date('2026-08-26T12:00:00.000Z')

function score(
  mode: PracticeMode,
  id: string,
  createdAt: string,
  component = 0.5,
): ProgressAttemptInput {
  const rubric = rubricFor(mode)
  const categories = {} as Record<SkillCategory, V2ScorePayload['categories'][SkillCategory]>
  for (const category of SKILL_CATEGORIES) {
    const maxPoints = rubric.categories[category].weight
    categories[category] = {
      category,
      availability: 'available',
      status: 'scored',
      component,
      earned_points: Math.round(component * maxPoints),
      max_points: maxPoints,
      measurements: {},
      evidence: [],
      deductions: [],
      warnings: [],
    }
  }
  return {
    id,
    createdAt,
    sectionScores: {
      version: V2_SCORE_PAYLOAD_VERSION,
      rubric_version: 'v2',
      mode,
      total_earned_points: Object.values(categories).reduce(
        (sum, category) => sum + (category.earned_points ?? 0),
        0,
      ),
      total_max_points: 100,
      categories,
      warnings: [],
    },
  }
}

function partialCategory(
  attempt: ProgressAttemptInput,
  category: SkillCategory,
): ProgressAttemptInput {
  const payload = attempt.sectionScores as V2ScorePayload
  return {
    ...attempt,
    sectionScores: {
      ...payload,
      total_earned_points: null,
      categories: {
        ...payload.categories,
        [category]: {
          ...payload.categories[category],
          status: 'not_checked',
          component: null,
          earned_points: null,
        },
      },
    },
  }
}

describe('v2 progress aggregation', () => {
  it('sorts stored overall and six-category histories chronologically', () => {
    const result = aggregateV2Progress(
      [
        score('practice', 'later', '2026-08-25T12:00:00.000Z', 0.8),
        score('practice', 'earlier', '2026-08-24T12:00:00.000Z', 0.4),
      ],
      { now: NOW },
    )

    expect(result.windows.all.overall.points.map((point) => point.attemptId)).toEqual([
      'earlier',
      'later',
    ])
    expect(result.windows.all.overall.valueCount).toBe(2)
    for (const category of SKILL_CATEGORIES) {
      expect(result.windows.all.categories[category].points).toHaveLength(2)
      expect(result.windows.all.categories[category].state).toBe('ready')
    }
  })

  it('filters by stored snapshot mode and selects one exact cohort', () => {
    const practice = score('practice', 'practice', '2026-08-24T12:00:00.000Z')
    const interview = score('interview', 'interview', '2026-08-25T12:00:00.000Z')

    const filtered = aggregateV2Progress([practice, interview], { now: NOW, mode: 'practice' })
    const defaulted = aggregateV2Progress([practice, interview], { now: NOW })

    expect(filtered.cohort?.mode).toBe('practice')
    expect(filtered.windows.all.attemptCount).toBe(1)
    expect(defaulted.cohort?.mode).toBe('interview')
    expect(defaulted.counts.excludedIncompatible).toBe(1)
  })

  it('uses deterministic recent and longer-history boundaries from caller time', () => {
    const recent = score('practice', 'recent', '2026-08-20T12:00:00.000Z')
    const history = score('practice', 'history', '2026-08-18T12:00:00.000Z')
    const old = score('practice', 'old', '2026-07-27T12:00:00.000Z')
    const result = aggregateV2Progress([old, history, recent], { now: NOW })

    expect(RECENT_PROGRESS_WINDOW_DAYS).toBe(7)
    expect(LONGER_HISTORY_WINDOW_DAYS).toBe(28)
    expect(result.windows.recent.overall.points.map((point) => point.attemptId)).toEqual(['recent'])
    expect(result.windows.longerHistory.overall.points.map((point) => point.attemptId)).toEqual([
      'history',
    ])
    expect(result.windows.all.overall.points.map((point) => point.attemptId)).toEqual([
      'old',
      'history',
      'recent',
    ])
  })

  it('uses real partial category values without treating unavailable values as perfect', () => {
    const full = score('presentation', 'full', '2026-08-24T12:00:00.000Z', 0.6)
    const partial = partialCategory(
      score('presentation', 'partial', '2026-08-25T12:00:00.000Z', 0.8),
      'grammar',
    )
    const result = aggregateV2Progress([full, partial], { now: NOW })

    expect(result.windows.all.overall.points).toHaveLength(1)
    expect(result.windows.all.categories.grammar.points).toHaveLength(1)
    expect(result.windows.all.categories.vocabulary.points).toHaveLength(2)
    expect(result.windows.all.categories.grammar.state).toBe('insufficient_data')
  })

  it('reports explicit insufficient-data states and empty cohort data', () => {
    const result = aggregateV2Progress([], { now: NOW })

    expect(result.cohort).toBeNull()
    expect(result.windows.all.attemptCount).toBe(0)
    expect(result.windows.all.overall).toMatchObject({
      state: 'insufficient_data',
      averagePoints: null,
    })
    expect(result.windows.recent.categories.fluency.state).toBe('insufficient_data')
  })

  it('rejects legacy, malformed, future, and incompatible score-version snapshots safely', () => {
    const valid = score('practice', 'valid', '2026-08-25T12:00:00.000Z')
    const legacy: ProgressAttemptInput = {
      id: 'legacy',
      createdAt: '2026-08-24T12:00:00.000Z',
      sectionScores: { content: { earned: 50 }, delivery: { earned: 50 } },
    }
    const unsupported: ProgressAttemptInput = {
      ...valid,
      id: 'unsupported',
      sectionScores: { ...(valid.sectionScores as V2ScorePayload), version: 'v3.score.1' },
    }
    const future = score('practice', 'future', '2026-08-27T12:00:00.000Z')
    const result = aggregateV2Progress([legacy, unsupported, future, valid], { now: NOW })

    expect(result.counts).toMatchObject({
      input: 4,
      validV2: 1,
      selectedCohort: 1,
      excludedInvalid: 3,
    })
    expect(result.windows.all.overall.state).toBe('insufficient_data')
  })

  it('honors an explicit exact cohort instead of mixing another compatible-looking mode', () => {
    const practice = score('practice', 'practice', '2026-08-24T12:00:00.000Z')
    const interview = score('interview', 'interview', '2026-08-25T12:00:00.000Z')
    const cohort = aggregateV2Progress([practice], { now: NOW }).cohort
    if (!cohort) throw new Error('Test fixture did not create a cohort.')
    const result = aggregateV2Progress([practice, interview], { now: NOW, cohort })

    expect(result.cohort?.mode).toBe('practice')
    expect(result.windows.all.overall.points.map((point) => point.attemptId)).toEqual(['practice'])
    expect(result.counts.excludedIncompatible).toBe(1)
  })
})
