import { SKILL_CATEGORIES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import type { LegacySectionSnapshot } from '@/lib/results/snapshot'
import {
  V2_SCORE_PAYLOAD_VERSION,
  type V2PersistedCategoryScore,
  type V2ScorePayload,
} from '@/lib/scoring/v2/assemble'
import { rubricFor } from '@/lib/scoring/v2/rubrics'

export const legacySectionSnapshot: LegacySectionSnapshot = {
  content: {
    earned: 50,
    max: 50,
    checks: {
      answered: 14,
      explained: 12,
      word_choice: 12,
      logical_order: 7,
      no_repetition: 5,
    },
  },
  delivery: {
    earned: 50,
    max: 50,
    metrics: {
      fillers: 18,
      mid_sentence_pauses: 14,
      energy: 8,
      pace: 6,
      time_to_first_word: 4,
    },
  },
}

interface V2SnapshotOptions {
  mode?: PracticeMode
  component?: number
  unavailableCategory?: SkillCategory
  notCheckedCategory?: SkillCategory
}

export function v2Snapshot(options: V2SnapshotOptions = {}): V2ScorePayload {
  const mode = options.mode ?? 'practice'
  const component = options.component ?? 0.8
  const rubric = rubricFor(mode)
  const categories = Object.fromEntries(
    SKILL_CATEGORIES.map((category) => {
      const maxPoints = rubric.categories[category].weight
      let result: V2PersistedCategoryScore
      if (category === options.unavailableCategory) {
        result = {
          category,
          availability: 'unavailable',
          status: 'unavailable',
          component: null,
          earned_points: null,
          max_points: maxPoints,
          measurements: null,
          evidence: [],
          deductions: [],
          warnings: ['Stored evidence was unavailable.'],
        }
      } else if (category === options.notCheckedCategory) {
        result = {
          category,
          availability: 'available',
          status: 'not_checked',
          component: null,
          earned_points: null,
          max_points: maxPoints,
          measurements: {},
          evidence: [],
          deductions: [],
          warnings: ['Stored evidence was not checked.'],
        }
      } else {
        result = {
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
      return [category, result]
    }),
  ) as Record<SkillCategory, V2PersistedCategoryScore>
  const complete = Object.values(categories).every((category) => category.status === 'scored')

  return {
    version: V2_SCORE_PAYLOAD_VERSION,
    rubric_version: 'v2',
    mode,
    total_earned_points: complete
      ? Object.values(categories).reduce(
          (total, category) => total + (category.earned_points ?? 0),
          0,
        )
      : null,
    total_max_points: 100,
    categories,
    warnings: [],
  }
}

export function progressAttempt(
  id: string,
  createdAt: string,
  sectionScores: unknown = v2Snapshot(),
  retryOfAttemptId: string | null = null,
) {
  return { id, createdAt, retryOfAttemptId, sectionScores }
}
