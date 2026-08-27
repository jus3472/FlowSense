import type { PracticeMode, SkillCategory } from '@/lib/practice/contracts'

export const RUBRIC_VERSION = 'v2' as const
export type RubricVersion = typeof RUBRIC_VERSION

export type Availability = 'available' | 'unavailable'
export type ScoreStatus = 'scored' | 'not_checked' | 'unavailable'

export type EvidenceCoordinate =
  | { space: 'transcript'; unit: 'utf16_code_unit' }
  | { space: 'audio_timeline'; unit: 'millisecond' | 'second' }

export interface ScoreEvidence {
  /** A stable source identifier, such as transcript or audio_timeline. */
  source: string
  /** A bounded location in the source when one is available. */
  start: number | null
  end: number | null
  /**
   * Explicit coordinates for new evidence. It remains optional so historical
   * v2 snapshots can still be read without assigning a guessed unit.
   */
  coordinate?: EvidenceCoordinate | null
  quote: string | null
  detail: string
}

export interface ScoreExplanation {
  summary: string
  details: readonly string[]
}

export interface AvailableCheckScoreResult {
  availability: 'available'
  status: 'scored' | 'not_checked'
  earned_points: number | null
  max_points: number
  explanation: ScoreExplanation | null
  evidence: readonly ScoreEvidence[]
}

/** An unavailable check never receives a made-up score. */
export interface UnavailableCheckScoreResult {
  availability: 'unavailable'
  status: 'unavailable'
  earned_points: null
  max_points: null
  explanation: null
  evidence: readonly []
}

export type CheckScoreResult = AvailableCheckScoreResult | UnavailableCheckScoreResult

export interface CategoryScoreResult {
  category: SkillCategory
  availability: Availability
  status: ScoreStatus
  earned_points: number | null
  max_points: number | null
  explanation: ScoreExplanation | null
  evidence: readonly ScoreEvidence[]
  checks: Readonly<Record<string, CheckScoreResult>>
}

export interface ScoreResult {
  rubric_version: RubricVersion
  mode: PracticeMode
  total_earned_points: number | null
  total_max_points: 100
  categories: Readonly<Record<SkillCategory, CategoryScoreResult>>
}

export interface RubricCheckDefinition {
  /** A check identifier is executable only when its registered evaluator consumes it. */
  id: string
  category: SkillCategory
  availability: Availability
  /** Optional checks are enabled only for modes where their evidence exists. */
  optional: boolean
}

export interface CategoryRubricConfig {
  availability: Availability
  weight: number
  /** Executable registered checks only; descriptive or planned checks do not belong here. */
  check_ids: readonly string[]
}

export interface ModeRubricConfig {
  version: RubricVersion
  mode: PracticeMode
  categories: Readonly<Record<SkillCategory, CategoryRubricConfig>>
  checks: readonly RubricCheckDefinition[]
}
