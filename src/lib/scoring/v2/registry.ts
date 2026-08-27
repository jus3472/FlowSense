import type { PracticeMode } from '@/lib/practice/contracts'
import { RUBRIC_VERSION, type ModeRubricConfig } from '@/lib/scoring/v2/contracts'
import { MODE_RUBRICS } from '@/lib/scoring/v2/rubrics'

export interface ScoringDefinition {
  readonly scorePayloadVersion: string
  readonly rubricVersion: string
  readonly modeRubrics: Readonly<Record<PracticeMode, ModeRubricConfig>>
}

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
export const SCORING_DEFINITIONS: readonly ScoringDefinition[] = Object.freeze([
  CURRENT_SCORING_DEFINITION,
])

function definitionKey(scorePayloadVersion: string, rubricVersion: string): string {
  return JSON.stringify([scorePayloadVersion, rubricVersion])
}

// This Map is private so callers cannot mutate the registry. Map lookup also
// avoids inherited-property keys such as __proto__ and constructor.
const DEFINITIONS_BY_PAIR = new Map(
  SCORING_DEFINITIONS.map((definition) => [
    definitionKey(definition.scorePayloadVersion, definition.rubricVersion),
    definition,
  ]),
)

export function scoringDefinitionFor(
  scorePayloadVersion: string,
  rubricVersion: string,
): ScoringDefinition | null {
  return DEFINITIONS_BY_PAIR.get(definitionKey(scorePayloadVersion, rubricVersion)) ?? null
}

export function supportsScoringDefinition(
  scorePayloadVersion: string,
  rubricVersion: string,
): boolean {
  return scoringDefinitionFor(scorePayloadVersion, rubricVersion) !== null
}
