import type { PracticeMode } from '@/lib/practice/contracts'
import { RUBRIC_VERSION, type ModeRubricConfig } from '@/lib/scoring/v2/contracts'
import { MODE_RUBRICS } from '@/lib/scoring/v2/rubrics'

export interface ScoringDefinition {
  readonly scorePayloadVersion: string
  readonly rubricVersion: string
  readonly modeRubrics: Readonly<Record<PracticeMode, ModeRubricConfig>>
}

type ScoringDefinitionRegistry = Readonly<
  Record<string, Readonly<Record<string, ScoringDefinition>>>
>

/** The definition used only when assembling a new score. */
export const CURRENT_SCORING_DEFINITION = Object.freeze({
  scorePayloadVersion: 'v2.score.1',
  rubricVersion: RUBRIC_VERSION,
  modeRubrics: MODE_RUBRICS,
} as const satisfies ScoringDefinition)

/**
 * Historical scoring definitions are addressed by their exact persisted pair.
 * Never substitute CURRENT_SCORING_DEFINITION when a lookup misses.
 */
export const SCORING_DEFINITION_REGISTRY: ScoringDefinitionRegistry = Object.freeze({
  [CURRENT_SCORING_DEFINITION.scorePayloadVersion]: Object.freeze({
    [CURRENT_SCORING_DEFINITION.rubricVersion]: CURRENT_SCORING_DEFINITION,
  }),
})

export function scoringDefinitionFor(
  scorePayloadVersion: string,
  rubricVersion: string,
): ScoringDefinition | null {
  return SCORING_DEFINITION_REGISTRY[scorePayloadVersion]?.[rubricVersion] ?? null
}

export function supportsScoringDefinition(
  scorePayloadVersion: string,
  rubricVersion: string,
): boolean {
  return scoringDefinitionFor(scorePayloadVersion, rubricVersion) !== null
}
