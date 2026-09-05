/** Stable identifiers shared by prompt selection and attempts. */
export const PRACTICE_MODES = ['practice', 'interview', 'presentation', 'conversation'] as const
export type PracticeMode = (typeof PRACTICE_MODES)[number]

export const PROMPT_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const
export type PromptDifficulty = (typeof PROMPT_DIFFICULTIES)[number]

export const PROMPT_SOURCES = ['library', 'custom'] as const
export type PromptSource = (typeof PROMPT_SOURCES)[number]
