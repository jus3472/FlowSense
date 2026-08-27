import {
  PRACTICE_MODES,
  SKILL_CATEGORIES,
  type PracticeMode,
  type SkillCategory,
} from '@/lib/practice/contracts'
import type { ClarityResult } from '@/lib/scoring/v2/clarity'
import type { V2CategoryResult, V2ContentEvaluation } from '@/lib/scoring/v2/content/contracts'
import type { DeliveryEvaluation } from '@/lib/scoring/v2/delivery'
import type { FluencyEvaluation } from '@/lib/scoring/v2/fluency'
import type { ScoreEvidence, ScoreStatus } from '@/lib/scoring/v2/contracts'
import { TRANSCRIPT_CHARACTER_COORDINATE } from '@/lib/scoring/v2/evidence'
import {
  CURRENT_SCORING_DEFINITION,
  scoringDefinitionFor,
  type ScoringDefinition,
} from '@/lib/scoring/v2/registry'

/** Stable JSONB discriminator. Do not use attempt metadata to identify a stored result. */
export const V2_SCORE_PAYLOAD_VERSION = CURRENT_SCORING_DEFINITION.scorePayloadVersion

type LocalEvaluation = FluencyEvaluation | DeliveryEvaluation | ClarityResult

export interface V2PersistedCategoryScore {
  category: SkillCategory
  availability: 'available' | 'unavailable'
  status: ScoreStatus
  component: number | null
  earned_points: number | null
  max_points: number
  measurements: unknown
  evidence: readonly ScoreEvidence[]
  deductions: readonly unknown[]
  warnings: readonly string[]
}

export interface V2ScorePayload {
  version: string
  rubric_version: string
  mode: PracticeMode
  total_earned_points: number | null
  total_max_points: 100
  categories: Readonly<Record<SkillCategory, V2PersistedCategoryScore>>
  warnings: readonly string[]
}

export type CurrentV2ScorePayload = V2ScorePayload & {
  version: typeof V2_SCORE_PAYLOAD_VERSION
  rubric_version: typeof CURRENT_SCORING_DEFINITION.rubricVersion
}

export interface V2AssemblyInput {
  mode: PracticeMode
  fluency: FluencyEvaluation
  delivery: DeliveryEvaluation
  clarity: ClarityResult
  content: V2ContentEvaluation
}

function inUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function unavailableCategory(
  category: SkillCategory,
  maxPoints: number,
  warning: string,
): V2PersistedCategoryScore {
  return {
    category,
    availability: 'unavailable',
    status: 'unavailable',
    component: null,
    earned_points: null,
    max_points: maxPoints,
    measurements: null,
    evidence: [],
    deductions: [],
    warnings: [warning],
  }
}

function fromLocal(evaluation: LocalEvaluation, maxPoints: number): V2PersistedCategoryScore {
  if (evaluation.status !== 'scored' || !inUnitInterval(evaluation.component)) {
    const malformedScoredValue = evaluation.status === 'scored'
    return {
      category: evaluation.category,
      availability: malformedScoredValue ? 'unavailable' : evaluation.availability,
      status: malformedScoredValue ? 'unavailable' : evaluation.status,
      component: null,
      earned_points: null,
      max_points: maxPoints,
      measurements: evaluation.measurements,
      evidence: evaluation.evidence,
      deductions: evaluation.deductions,
      warnings: malformedScoredValue
        ? [...evaluation.warnings, `${evaluation.category} produced an invalid component.`]
        : evaluation.warnings,
    }
  }
  return {
    category: evaluation.category,
    availability: 'available',
    status: 'scored',
    component: evaluation.component,
    earned_points: Math.round(evaluation.component * maxPoints),
    max_points: maxPoints,
    measurements: evaluation.measurements,
    evidence: evaluation.evidence,
    deductions: evaluation.deductions,
    warnings: evaluation.warnings,
  }
}

function fromContent(
  evaluation: V2CategoryResult | undefined,
  category: V2CategoryResult['category'],
  maxPoints: number,
): V2PersistedCategoryScore {
  if (!evaluation || evaluation.category !== category) {
    return unavailableCategory(category, maxPoints, `${category} result was missing or malformed.`)
  }
  if (evaluation.status !== 'checked' || !inUnitInterval(evaluation.component)) {
    const malformedCheckedValue = evaluation.status === 'checked'
    return {
      category,
      availability: 'available',
      status: 'not_checked',
      component: null,
      earned_points: null,
      max_points: maxPoints,
      measurements: evaluation.measurements,
      evidence: evaluation.findings.flatMap((finding) =>
        finding.evidence.map((evidence) => ({
          source: 'transcript',
          start: evidence.start,
          end: evidence.end,
          coordinate: TRANSCRIPT_CHARACTER_COORDINATE,
          quote: finding.quote,
          detail: finding.observation,
        })),
      ),
      deductions: evaluation.findings,
      warnings: malformedCheckedValue
        ? [...evaluation.warnings, `${category} provider result had an invalid component.`]
        : evaluation.warnings,
    }
  }
  return {
    category,
    availability: 'available',
    status: 'scored',
    component: evaluation.component,
    earned_points: Math.round(evaluation.component * maxPoints),
    max_points: maxPoints,
    measurements: evaluation.measurements,
    evidence: evaluation.findings.flatMap((finding) =>
      finding.evidence.map((evidence) => ({
        source: 'transcript',
        start: evidence.start,
        end: evidence.end,
        coordinate: TRANSCRIPT_CHARACTER_COORDINATE,
        quote: finding.quote,
        detail: finding.observation,
      })),
    ),
    deductions: evaluation.findings,
    warnings: evaluation.warnings,
  }
}

/**
 * Converts evaluator components into one 100-point v2 response result. An
 * incomplete category deliberately makes the overall score unavailable instead
 * of treating absent provider or capture evidence as a perfect result.
 */
export function assembleV2Score(input: V2AssemblyInput): CurrentV2ScorePayload {
  const rubric = CURRENT_SCORING_DEFINITION.modeRubrics[input.mode]
  const categories = {
    fluency: fromLocal(input.fluency, rubric.categories.fluency.weight),
    clarity: fromLocal(input.clarity, rubric.categories.clarity.weight),
    vocabulary: fromContent(
      input.content.categories.vocabulary,
      'vocabulary',
      rubric.categories.vocabulary.weight,
    ),
    grammar: fromContent(
      input.content.categories.grammar,
      'grammar',
      rubric.categories.grammar.weight,
    ),
    structure: fromContent(
      input.content.categories.structure,
      'structure',
      rubric.categories.structure.weight,
    ),
    delivery: fromLocal(input.delivery, rubric.categories.delivery.weight),
  }
  const values = Object.values(categories)
  const complete = values.every((category) => category.status === 'scored')
  const total = complete
    ? values.reduce((sum, category) => sum + (category.earned_points ?? 0), 0)
    : null
  const warnings = values.flatMap((category) => category.warnings)

  return {
    version: V2_SCORE_PAYLOAD_VERSION,
    rubric_version: CURRENT_SCORING_DEFINITION.rubricVersion,
    mode: input.mode,
    total_earned_points: total,
    total_max_points: 100,
    categories,
    warnings,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function validEvidenceCoordinate(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (!isRecord(value) || Object.keys(value).length !== 2) return false
  return (
    (value.space === 'transcript' && value.unit === 'utf16_code_unit') ||
    (value.space === 'audio_timeline' && (value.unit === 'millisecond' || value.unit === 'second'))
  )
}

function validEvidenceBounds(value: Record<string, unknown>): boolean {
  const { start, end, coordinate, quote } = value
  if (start === null || end === null) return start === null && end === null
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start
  ) {
    return false
  }
  if (
    isRecord(coordinate) &&
    coordinate.space === 'transcript' &&
    coordinate.unit === 'utf16_code_unit'
  ) {
    return (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      end > start &&
      (quote === null || (typeof quote === 'string' && quote.length === end - start))
    )
  }
  return true
}

function validStoredEvidence(value: unknown): value is ScoreEvidence {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    typeof value.detail === 'string' &&
    (typeof value.quote === 'string' || value.quote === null) &&
    validEvidenceCoordinate(value.coordinate) &&
    validEvidenceBounds(value)
  )
}

function validDeductionEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.start === 'number' &&
    Number.isInteger(value.start) &&
    value.start >= 0 &&
    typeof value.end === 'number' &&
    Number.isInteger(value.end) &&
    value.end > value.start &&
    (value.confidence === undefined || inUnitInterval(value.confidence))
  )
}

function validStoredDeduction(value: unknown): boolean {
  if (!isRecord(value)) return false

  for (const key of ['id', 'check', 'kind', 'severity', 'detail', 'observation']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false
  }
  for (const key of ['quote', 'suggestion']) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') {
      return false
    }
  }
  for (const key of ['component', 'component_reduction', 'deduction']) {
    if (value[key] !== undefined && !inUnitInterval(value[key])) return false
  }
  if (
    value.evidence !== undefined &&
    (!Array.isArray(value.evidence) || !value.evidence.every(validDeductionEvidence))
  ) {
    return false
  }

  return typeof value.detail === 'string' || typeof value.observation === 'string'
}

function validStoredCategory(
  value: unknown,
  category: SkillCategory,
  mode: PracticeMode,
  definition: ScoringDefinition,
): boolean {
  if (!isRecord(value)) return false
  const maxPoints = definition.modeRubrics[mode].categories[category].weight
  const component = value.component
  const earnedPoints = value.earned_points
  const pointsAreValid =
    (earnedPoints === null ||
      (typeof earnedPoints === 'number' &&
        Number.isInteger(earnedPoints) &&
        earnedPoints >= 0 &&
        earnedPoints <= maxPoints)) &&
    (component === null || inUnitInterval(component))
  if (
    !pointsAreValid ||
    value.category !== category ||
    value.max_points !== maxPoints ||
    !('measurements' in value) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(validStoredEvidence) ||
    !Array.isArray(value.deductions) ||
    !value.deductions.every(validStoredDeduction) ||
    !isStringArray(value.warnings)
  ) {
    return false
  }

  if (value.status === 'scored') {
    return (
      value.availability === 'available' &&
      inUnitInterval(component) &&
      typeof earnedPoints === 'number' &&
      earnedPoints === Math.round(component * maxPoints)
    )
  }
  if (value.status === 'not_checked') {
    return value.availability === 'available' && component === null && earnedPoints === null
  }
  return (
    value.status === 'unavailable' &&
    value.availability === 'unavailable' &&
    component === null &&
    earnedPoints === null
  )
}

/** Validates one payload against the exact definition selected by its stored pair. */
export function isScorePayloadForDefinition(
  value: unknown,
  definition: ScoringDefinition,
): value is V2ScorePayload {
  if (!isRecord(value)) return false
  const mode = value.mode
  const categoryValues = value.categories
  if (
    value.version !== definition.scorePayloadVersion ||
    value.rubric_version !== definition.rubricVersion ||
    !isPracticeMode(mode) ||
    value.total_max_points !== 100 ||
    !isRecord(categoryValues) ||
    !isStringArray(value.warnings)
  ) {
    return false
  }
  const categoryNames = Object.keys(categoryValues)
  if (
    categoryNames.length !== SKILL_CATEGORIES.length ||
    !SKILL_CATEGORIES.every((category) =>
      validStoredCategory(categoryValues[category], category, mode, definition),
    )
  ) {
    return false
  }
  const categories = Object.values(categoryValues)
  const allScored = categories.every(
    (category) => isRecord(category) && category.status === 'scored',
  )
  const total = value.total_earned_points
  if (!allScored) return total === null
  return (
    typeof total === 'number' &&
    Number.isInteger(total) &&
    total >= 0 &&
    total <= 100 &&
    total ===
      categories.reduce<number>(
        (sum, category) => sum + (isRecord(category) ? Number(category.earned_points) : 0),
        0,
      )
  )
}

/**
 * Only a structurally complete payload with a registered exact version pair is
 * idempotent. Unknown pairs never inherit the current scoring definition.
 */
export function isV2ScorePayload(value: unknown): value is V2ScorePayload {
  if (
    !isRecord(value) ||
    typeof value.version !== 'string' ||
    typeof value.rubric_version !== 'string'
  ) {
    return false
  }
  const definition = scoringDefinitionFor(value.version, value.rubric_version)
  return definition !== null && isScorePayloadForDefinition(value, definition)
}

/** A saved legacy section payload is authoritative even if its attempt metadata says v2. */
export function hasStoredScorePayload(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isV2ScorePayload(value) || (isRecord(value.content) && isRecord(value.delivery))
}

/** Legacy snapshots keep their existing retry behavior; only v2 snapshots lock scoring. */
export function shouldReuseStoredV2Score(value: unknown): boolean {
  return isV2ScorePayload(value)
}

export function isPracticeMode(value: unknown): value is PracticeMode {
  return typeof value === 'string' && (PRACTICE_MODES as readonly string[]).includes(value)
}
