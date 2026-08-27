import { PRACTICE_MODES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import { RUBRIC_VERSION, type ModeRubricConfig } from '@/lib/scoring/v2/contracts'

const NO_EXECUTABLE_CHECKS = Object.freeze([])

function category(weight: number) {
  return Object.freeze({
    availability: 'available' as const,
    weight,
    check_ids: NO_EXECUTABLE_CHECKS,
  })
}

function categories(weights: Readonly<Record<SkillCategory, number>>) {
  return Object.freeze({
    fluency: category(weights.fluency),
    clarity: category(weights.clarity),
    vocabulary: category(weights.vocabulary),
    grammar: category(weights.grammar),
    structure: category(weights.structure),
    delivery: category(weights.delivery),
  }) satisfies ModeRubricConfig['categories']
}

function rubric(
  mode: PracticeMode,
  weights: Readonly<Record<SkillCategory, number>>,
): ModeRubricConfig {
  return Object.freeze({
    version: RUBRIC_VERSION,
    mode,
    categories: categories(weights),
    checks: NO_EXECUTABLE_CHECKS,
  })
}

/**
 * The v2.score.1 evaluators are invoked as category modules, not through named
 * rubric checks. Executable check metadata is therefore intentionally empty.
 * Adding configuration-driven checks requires a new immutable version pair.
 */
export const MODE_RUBRICS: Readonly<Record<PracticeMode, ModeRubricConfig>> = Object.freeze({
  practice: rubric('practice', {
    fluency: 22,
    clarity: 20,
    vocabulary: 12,
    grammar: 12,
    structure: 18,
    delivery: 16,
  }),
  interview: rubric('interview', {
    fluency: 18,
    clarity: 22,
    vocabulary: 14,
    grammar: 12,
    structure: 22,
    delivery: 12,
  }),
  presentation: rubric('presentation', {
    fluency: 16,
    clarity: 20,
    vocabulary: 14,
    grammar: 10,
    structure: 20,
    delivery: 20,
  }),
  conversation: rubric('conversation', {
    fluency: 24,
    clarity: 22,
    vocabulary: 12,
    grammar: 12,
    structure: 14,
    delivery: 16,
  }),
})

/** Current-score convenience only. Historical readers must resolve the stored version pair. */
export function rubricFor(mode: PracticeMode): ModeRubricConfig {
  return MODE_RUBRICS[mode]
}

export { PRACTICE_MODES }
