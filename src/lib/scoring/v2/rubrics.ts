import { PRACTICE_MODES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import { RUBRIC_VERSION, type ModeRubricConfig } from '@/lib/scoring/v2/contracts'

const CORE_CHECKS = [
  { id: 'fluency.filler_control', category: 'fluency', availability: 'available', optional: false },
  { id: 'clarity.direct_answer', category: 'clarity', availability: 'available', optional: false },
  {
    id: 'vocabulary.precise_wording',
    category: 'vocabulary',
    availability: 'available',
    optional: false,
  },
  {
    id: 'grammar.sentence_control',
    category: 'grammar',
    availability: 'available',
    optional: false,
  },
  {
    id: 'structure.logical_order',
    category: 'structure',
    availability: 'available',
    optional: false,
  },
  { id: 'delivery.pace', category: 'delivery', availability: 'available', optional: false },
] as const

const MODE_CHECKS: Record<PracticeMode, ModeRubricConfig['checks'][number]> = {
  practice: {
    id: 'structure.prompt_coverage',
    category: 'structure',
    availability: 'available',
    optional: true,
  },
  interview: {
    id: 'structure.role_response',
    category: 'structure',
    availability: 'available',
    optional: true,
  },
  presentation: {
    id: 'delivery.audience_signposting',
    category: 'delivery',
    availability: 'available',
    optional: true,
  },
  conversation: {
    id: 'fluency.turn_taking',
    category: 'fluency',
    availability: 'unavailable',
    optional: true,
  },
}

function category(weight: number, checkIds: readonly string[]) {
  return { availability: 'available' as const, weight, check_ids: checkIds }
}

function categories(
  weights: Readonly<Record<SkillCategory, number>>,
  modeCheck: ModeRubricConfig['checks'][number],
) {
  const allChecks = [...CORE_CHECKS, modeCheck]
  return Object.fromEntries(
    (Object.keys(weights) as SkillCategory[]).map((name) => [
      name,
      category(
        weights[name],
        allChecks.filter((check) => check.category === name).map((check) => check.id),
      ),
    ]),
  ) as ModeRubricConfig['categories']
}

function rubric(
  mode: PracticeMode,
  weights: Readonly<Record<SkillCategory, number>>,
): ModeRubricConfig {
  const modeCheck = MODE_CHECKS[mode]
  return {
    version: RUBRIC_VERSION,
    mode,
    categories: categories(weights, modeCheck),
    checks: [...CORE_CHECKS, modeCheck],
  }
}

export const MODE_RUBRICS: Readonly<Record<PracticeMode, ModeRubricConfig>> = {
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
}

/** Keeps callers from depending on the storage shape of the rubric collection. */
export function rubricFor(mode: PracticeMode): ModeRubricConfig {
  return MODE_RUBRICS[mode]
}

export { PRACTICE_MODES }
