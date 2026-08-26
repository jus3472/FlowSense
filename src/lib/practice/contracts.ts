/** Stable identifiers shared by prompt selection, attempts, and v2 scoring. */
export const PRACTICE_MODES = ['practice', 'interview', 'presentation', 'conversation'] as const
export type PracticeMode = (typeof PRACTICE_MODES)[number]

export const PROMPT_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const
export type PromptDifficulty = (typeof PROMPT_DIFFICULTIES)[number]

export const PROMPT_SOURCES = ['library', 'custom'] as const
export type PromptSource = (typeof PROMPT_SOURCES)[number]

/** These names are persisted identifiers, not user-facing labels. */
export const SKILL_CATEGORIES = [
  'fluency',
  'clarity',
  'vocabulary',
  'grammar',
  'structure',
  'delivery',
] as const
export type SkillCategory = (typeof SKILL_CATEGORIES)[number]

export interface PracticePromptContract {
  mode: PracticeMode
  difficulty: PromptDifficulty
  source: PromptSource
}
