import { SKILL_CATEGORIES, type SkillCategory } from '@/lib/practice/contracts'
import type { V2ScorePayload } from '@/lib/scoring/v2/assemble'

/** A display hint only. It never suppresses numeric stored-result evidence. */
export const RETRY_COMPARISON_NOISE_POINTS = 2
export const MAX_RETRY_CHAIN_LENGTH = 8

export interface RetryComparisonRow {
  category: SkillCategory | 'overall'
  label: string
  currentPoints: number
  previousPoints: number
  maxPoints: number
  deltaPoints: number
  withinNoise: boolean
}

export interface RetryComparison {
  rows: readonly RetryComparisonRow[]
}

export interface RetryChainNode {
  id: string
  retryOfAttemptId: string | null
}

/** Loads a complete, bounded chain and fails closed for invalid links. */
export async function loadRetryAncestorChain<T extends RetryChainNode>(
  startId: string,
  load: (id: string) => Promise<T | null>,
): Promise<readonly T[] | null> {
  if (typeof startId !== 'string' || startId.length === 0) return null
  const ancestors: T[] = []
  const seen = new Set<string>([startId])
  let currentId = startId
  let current = await load(currentId)
  for (let depth = 0; depth <= MAX_RETRY_CHAIN_LENGTH; depth += 1) {
    if (
      !current ||
      typeof current.id !== 'string' ||
      current.id !== currentId ||
      (current.retryOfAttemptId !== null && typeof current.retryOfAttemptId !== 'string')
    )
      return null
    if (current.retryOfAttemptId === null) return ancestors
    if (depth === MAX_RETRY_CHAIN_LENGTH) return null
    if (seen.has(current.retryOfAttemptId)) return null
    seen.add(current.retryOfAttemptId)
    currentId = current.retryOfAttemptId
    current = await load(currentId)
    if (!current || current.id !== currentId) return null
    ancestors.push(current)
  }
  return null
}

function compatible(current: V2ScorePayload, previous: V2ScorePayload): boolean {
  return (
    current.version === previous.version &&
    current.rubric_version === previous.rubric_version &&
    current.mode === previous.mode &&
    SKILL_CATEGORIES.every(
      (category) =>
        current.categories[category].max_points === previous.categories[category].max_points,
    )
  )
}

function categoryLabel(category: SkillCategory): string {
  return category.slice(0, 1).toUpperCase() + category.slice(1)
}

/** Compares only compatible stored v2 snapshots, with no quality interpretation. */
export function compareRetryResults(
  current: V2ScorePayload,
  previous: V2ScorePayload | null,
): RetryComparison | null {
  if (!previous || !compatible(current, previous)) return null
  const rows: RetryComparisonRow[] = []
  if (current.total_earned_points !== null && previous.total_earned_points !== null) {
    const deltaPoints = current.total_earned_points - previous.total_earned_points
    rows.push({
      category: 'overall',
      label: 'Overall',
      currentPoints: current.total_earned_points,
      previousPoints: previous.total_earned_points,
      maxPoints: current.total_max_points,
      deltaPoints,
      withinNoise: Math.abs(deltaPoints) <= RETRY_COMPARISON_NOISE_POINTS,
    })
  }
  for (const category of SKILL_CATEGORIES) {
    const currentCategory = current.categories[category]
    const previousCategory = previous.categories[category]
    if (
      currentCategory.status !== 'scored' ||
      previousCategory.status !== 'scored' ||
      currentCategory.earned_points === null ||
      previousCategory.earned_points === null
    )
      continue
    const deltaPoints = currentCategory.earned_points - previousCategory.earned_points
    rows.push({
      category,
      label: categoryLabel(category),
      currentPoints: currentCategory.earned_points,
      previousPoints: previousCategory.earned_points,
      maxPoints: currentCategory.max_points,
      deltaPoints,
      withinNoise: Math.abs(deltaPoints) <= RETRY_COMPARISON_NOISE_POINTS,
    })
  }
  return { rows }
}
