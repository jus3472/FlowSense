import type { ProgressSeries } from '@/lib/progress/aggregation'
import {
  PRACTICE_MODES,
  SKILL_CATEGORIES,
  type PracticeMode,
  type SkillCategory,
} from '@/lib/practice/contracts'

export function parseProgressMode(value: unknown): PracticeMode | undefined {
  return typeof value === 'string' && (PRACTICE_MODES as readonly string[]).includes(value)
    ? (value as PracticeMode)
    : undefined
}

export function selectCategory(
  series: Readonly<Record<SkillCategory, ProgressSeries>>,
  descending: boolean,
): SkillCategory | null {
  const ranked = SKILL_CATEGORIES.filter((category) => series[category].state === 'ready').sort(
    (left, right) => {
      const delta = (series[right].averageValue ?? 0) - (series[left].averageValue ?? 0)
      return descending ? delta : -delta
    },
  )
  if (ranked.length === 0) return null
  const first = ranked[0]
  const second = ranked[1]
  if (first && second && series[first].averageValue === series[second].averageValue) {
    return null
  }
  return first ?? null
}
