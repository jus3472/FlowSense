import { SKILL_CATEGORIES, type SkillCategory } from '@/lib/practice/contracts'
import type { V2ScorePayload } from '@/lib/scoring/v2/assemble'

/** Small changes are ordinary scoring variation, so do not surface a row. */
export const RETRY_COMPARISON_NOISE_POINTS = 2
export const MAX_RETRY_CHAIN_LENGTH = 8

export interface RetryComparisonRow {
  category: SkillCategory
  currentPoints: number
  previousPoints: number
  maxPoints: number
  deltaPoints: number
}

export interface RetryComparison {
  previousAttemptId: string
  rows: readonly RetryComparisonRow[]
}

interface RetryChainNode {
  id: string
  retryOfAttemptId: string | null
}

/**
 * Returns a complete, bounded ancestor chain. A missing, cyclic, or malformed
 * link makes the chain unavailable rather than guessing at history.
 */
export function retryAncestorIds(
  startId: string,
  nodes: readonly RetryChainNode[],
): readonly string[] | null {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids: string[] = []
  const seen = new Set<string>([startId])
  let current = byId.get(startId)
  while (current?.retryOfAttemptId) {
    if (typeof current.id !== 'string' || typeof current.retryOfAttemptId !== 'string') return null
    if (ids.length >= MAX_RETRY_CHAIN_LENGTH || seen.has(current.retryOfAttemptId)) return null
    const parent = byId.get(current.retryOfAttemptId)
    if (!parent) return null
    seen.add(parent.id)
    ids.push(parent.id)
    current = parent
  }
  return current ? ids : null
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

/**
 * Compares only direct-parent, stored v2 snapshots. It deliberately makes no
 * quality claim: rows are numeric evidence and omit normal scoring variation.
 */
export function compareRetryResults(
  currentAttemptId: string,
  previousAttemptId: string | null,
  current: V2ScorePayload,
  previous: V2ScorePayload | null,
): RetryComparison | null {
  if (!previousAttemptId || !previous || !compatible(current, previous)) return null
  const rows = SKILL_CATEGORIES.flatMap((category) => {
    const currentCategory = current.categories[category]
    const previousCategory = previous.categories[category]
    if (currentCategory.status !== 'scored' || previousCategory.status !== 'scored') return []
    const currentPoints = currentCategory.earned_points
    const previousPoints = previousCategory.earned_points
    if (currentPoints === null || previousPoints === null) return []
    const deltaPoints = currentPoints - previousPoints
    return Math.abs(deltaPoints) > RETRY_COMPARISON_NOISE_POINTS
      ? [
          {
            category,
            currentPoints,
            previousPoints,
            maxPoints: currentCategory.max_points,
            deltaPoints,
          },
        ]
      : []
  })
  if (currentAttemptId === previousAttemptId) return null
  return { previousAttemptId, rows }
}
