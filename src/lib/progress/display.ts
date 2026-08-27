import type { ProgressSeries } from '@/lib/progress/aggregation'
import {
  PRACTICE_MODES,
  SKILL_CATEGORIES,
  type PracticeMode,
  type SkillCategory,
} from '@/lib/practice/contracts'

export type ProgressModeParseResult =
  { status: 'valid'; mode?: PracticeMode } | { status: 'invalid' }

export function parseProgressMode(value: unknown): ProgressModeParseResult {
  if (value === undefined) return { status: 'valid' }
  if (typeof value !== 'string' || !(PRACTICE_MODES as readonly string[]).includes(value)) {
    return { status: 'invalid' }
  }
  return { status: 'valid', mode: value as PracticeMode }
}

export function selectCategory(
  series: Readonly<Record<SkillCategory, ProgressSeries>>,
  descending: boolean,
): SkillCategory | null {
  const comparable = SKILL_CATEGORIES.map((category) => ({ category, series: series[category] }))
  const referencePopulation = comparable[0]?.series.points.map((point) => point.attemptId) ?? []
  if (
    comparable.some(
      ({ series: candidate }) =>
        candidate.state !== 'ready' ||
        candidate.averageValue === null ||
        !Number.isFinite(candidate.averageValue) ||
        candidate.valueCount !== candidate.points.length ||
        candidate.points.length !== referencePopulation.length ||
        candidate.points.some((point, index) => point.attemptId !== referencePopulation[index]),
    )
  ) {
    return null
  }

  const ranked = comparable.sort((left, right) => {
    const delta = (right.series.averageValue ?? 0) - (left.series.averageValue ?? 0)
    return descending ? delta : -delta
  })
  if (ranked.length === 0) return null
  const first = ranked[0]
  const second = ranked[1]
  if (first && second && first.series.averageValue === second.series.averageValue) {
    return null
  }
  return first?.category ?? null
}
