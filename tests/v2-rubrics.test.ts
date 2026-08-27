import { PRACTICE_MODES, SKILL_CATEGORIES } from '@/lib/practice/contracts'
import {
  CURRENT_SCORING_DEFINITION,
  SCORING_DEFINITIONS,
  scoringDefinitionFor,
  supportsScoringDefinition,
} from '@/lib/scoring/v2/registry'
import { MODE_RUBRICS, rubricFor } from '@/lib/scoring/v2/rubrics'
import { describe, expect, it } from 'vitest'

const EXPECTED_WEIGHTS = {
  practice: {
    fluency: 22,
    clarity: 20,
    vocabulary: 12,
    grammar: 12,
    structure: 18,
    delivery: 16,
  },
  interview: {
    fluency: 18,
    clarity: 22,
    vocabulary: 14,
    grammar: 12,
    structure: 22,
    delivery: 12,
  },
  presentation: {
    fluency: 16,
    clarity: 20,
    vocabulary: 14,
    grammar: 10,
    structure: 20,
    delivery: 20,
  },
  conversation: {
    fluency: 24,
    clarity: 22,
    vocabulary: 12,
    grammar: 12,
    structure: 14,
    delivery: 16,
  },
} as const

describe('v2 scoring definitions', () => {
  it('locks the exact current weight matrix and all six stable categories', () => {
    expect(Object.keys(MODE_RUBRICS)).toEqual([...PRACTICE_MODES])

    for (const mode of PRACTICE_MODES) {
      const rubric = rubricFor(mode)
      expect(rubric.mode).toBe(mode)
      expect(rubric.version).toBe('v2')
      expect(Object.keys(rubric.categories)).toEqual([...SKILL_CATEGORIES])
      expect(
        Object.fromEntries(
          SKILL_CATEGORIES.map((category) => [category, rubric.categories[category].weight]),
        ),
      ).toEqual(EXPECTED_WEIGHTS[mode])
      expect(
        Object.values(rubric.categories).reduce((total, category) => total + category.weight, 0),
      ).toBe(100)
    }
  })

  it('resolves only the exact registered score and rubric pair', () => {
    expect(scoringDefinitionFor('v2.score.1', 'v2')).toBe(CURRENT_SCORING_DEFINITION)
    expect(supportsScoringDefinition('v2.score.1', 'v2')).toBe(true)
    expect(SCORING_DEFINITIONS).toEqual([CURRENT_SCORING_DEFINITION])

    expect(scoringDefinitionFor('v3.score.1', 'v2')).toBeNull()
    expect(scoringDefinitionFor('v2.score.1', 'v3')).toBeNull()
    expect(scoringDefinitionFor('v3.score.1', 'v3')).toBeNull()
    expect(supportsScoringDefinition('v2.score.1', 'v3')).toBe(false)
  })

  it.each(['__proto__', 'constructor', 'prototype', 'toString', ''])(
    'fails closed for the hostile registry key %j',
    (key) => {
      expect(scoringDefinitionFor(key, 'v2')).toBeNull()
      expect(scoringDefinitionFor('v2.score.1', key)).toBeNull()
      expect(scoringDefinitionFor(key, key)).toBeNull()
      expect(supportsScoringDefinition(key, 'v2')).toBe(false)
      expect(supportsScoringDefinition('v2.score.1', key)).toBe(false)
    },
  )

  it('freezes the registry, definition, rubrics, categories, and check lists', () => {
    const rubric = rubricFor('practice')
    const category = rubric.categories.fluency

    expect(Object.isFrozen(SCORING_DEFINITIONS)).toBe(true)
    expect(Object.isFrozen(CURRENT_SCORING_DEFINITION)).toBe(true)
    expect(Object.isFrozen(CURRENT_SCORING_DEFINITION.modeRubrics)).toBe(true)
    expect(Object.isFrozen(MODE_RUBRICS)).toBe(true)
    expect(Object.isFrozen(rubric)).toBe(true)
    expect(Object.isFrozen(rubric.categories)).toBe(true)
    expect(Object.isFrozen(category)).toBe(true)
    expect(Object.isFrozen(category.check_ids)).toBe(true)
    expect(Object.isFrozen(rubric.checks)).toBe(true)

    expect(Reflect.set(category, 'weight', 99)).toBe(false)
    expect(rubric.categories.fluency.weight).toBe(22)
    expect(Reflect.set(CURRENT_SCORING_DEFINITION, 'rubricVersion', 'future')).toBe(false)
    expect(CURRENT_SCORING_DEFINITION.rubricVersion).toBe('v2')
    expect(Reflect.set(MODE_RUBRICS, 'practice', rubricFor('interview'))).toBe(false)
    expect(rubricFor('practice').mode).toBe('practice')
  })

  it('does not present aspirational check identifiers as executable', () => {
    const aspirationalIds = [
      'clarity.direct_answer',
      'delivery.pace',
      'structure.prompt_coverage',
      'structure.role_response',
      'delivery.audience_signposting',
      'fluency.turn_taking',
    ]

    for (const mode of PRACTICE_MODES) {
      const rubric = rubricFor(mode)
      expect(rubric.checks).toEqual([])
      expect(SKILL_CATEGORIES.flatMap((category) => rubric.categories[category].check_ids)).toEqual(
        [],
      )
      for (const id of aspirationalIds) expect(JSON.stringify(rubric)).not.toContain(id)
    }
  })
})
