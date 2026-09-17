import { PRACTICE_MODES, type PracticeMode } from '@/lib/practice/contracts'

export const PRACTICE_CATEGORIES = [...PRACTICE_MODES, 'other'] as const

export type PracticeCategory = (typeof PRACTICE_CATEGORIES)[number]

export function parsePracticeCategory(value: unknown): PracticeCategory | null {
  return typeof value === 'string' && (PRACTICE_CATEGORIES as readonly string[]).includes(value)
    ? (value as PracticeCategory)
    : null
}

export function practiceModeForCategory(category: PracticeCategory): PracticeMode {
  return category === 'other' ? 'practice' : category
}

/**
 * Reads the optional category snapshot while retaining legacy mode behavior.
 * Contradictory metadata is ignored, and Other is never inferred for non-custom attempts.
 */
export function practiceCategoryFromMetrics(
  metrics: unknown,
  storedMode: unknown,
  source?: unknown,
): PracticeCategory | null {
  const practice =
    typeof metrics === 'object' && metrics !== null && !Array.isArray(metrics)
      ? (metrics as Record<string, unknown>).practice
      : undefined
  const categoryValue =
    typeof practice === 'object' && practice !== null && !Array.isArray(practice)
      ? (practice as Record<string, unknown>).category
      : undefined
  return practiceCategoryFromValue(categoryValue, storedMode, source)
}

/** Also accepts the narrow JSON-path projection used by History and Progress queries. */
export function practiceCategoryFromValue(
  categoryValue: unknown,
  storedMode: unknown,
  source?: unknown,
): PracticeCategory | null {
  const mode = PRACTICE_MODES.includes(storedMode as PracticeMode)
    ? (storedMode as PracticeMode)
    : null
  if (!mode) return null
  const category = parsePracticeCategory(categoryValue)

  if (
    category &&
    practiceModeForCategory(category) === mode &&
    (category !== 'other' || source === undefined || source === 'custom')
  ) {
    return category
  }

  return mode
}
