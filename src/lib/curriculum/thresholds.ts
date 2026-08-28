import type { Stars } from '@/lib/curriculum/contracts'

export const PASSING_SCORE = 70
export const TWO_STAR_SCORE = 80
export const THREE_STAR_SCORE = 90

/**
 * Accepts only stored whole-number scores in the curriculum's 0 through 100 range.
 * Null and malformed values remain neutral instead of being reinterpreted as zero.
 */
export function parseCurriculumScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : null
}

export function starsForScore(value: unknown): Stars {
  const score = parseCurriculumScore(value)
  if (score === null) return 0
  if (score >= THREE_STAR_SCORE) return 3
  if (score >= TWO_STAR_SCORE) return 2
  if (score >= PASSING_SCORE) return 1
  return 0
}

export function isPassingScore(value: unknown): boolean {
  const score = parseCurriculumScore(value)
  return score !== null && score >= PASSING_SCORE
}
