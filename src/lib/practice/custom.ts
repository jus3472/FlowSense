import { PRACTICE_MODES, type PracticeMode } from '@/lib/practice/contracts'

export const MAX_CUSTOM_PROMPT_LENGTH = 1_000
export const MAX_CUSTOM_CONTEXT_LENGTH = 1_000
export const MIN_CUSTOM_TARGET_DURATION_SECONDS = 15
export const MAX_CUSTOM_TARGET_DURATION_SECONDS = 60

export interface CustomPracticeInput {
  promptText: string
  mode: PracticeMode
  additionalContext?: string
  targetDurationSeconds: number
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null
  const result = value.trim()
  return result.length <= limit ? result : null
}

export function parseCustomPracticeInput(value: unknown): CustomPracticeInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const promptText = text(record.promptText, MAX_CUSTOM_PROMPT_LENGTH)
  const context = text(record.additionalContext ?? '', MAX_CUSTOM_CONTEXT_LENGTH)
  const mode = record.mode
  const targetDurationSeconds = record.targetDurationSeconds
  if (
    !promptText ||
    context === null ||
    !PRACTICE_MODES.includes(mode as PracticeMode) ||
    !Number.isInteger(targetDurationSeconds) ||
    typeof targetDurationSeconds !== 'number' ||
    targetDurationSeconds < MIN_CUSTOM_TARGET_DURATION_SECONDS ||
    targetDurationSeconds > MAX_CUSTOM_TARGET_DURATION_SECONDS
  ) return null
  return { promptText, mode: mode as PracticeMode, ...(context ? { additionalContext: context } : {}), targetDurationSeconds }
}

export const CUSTOM_SESSION_COOKIE = 'flowsense_custom_session'

/** A custom session is only consumed after the action's explicit redirect. */
export function isCustomPracticeMarker(value: unknown): boolean {
  return value === '1'
}

export function serializeCustomPracticeInput(value: CustomPracticeInput): string {
  return encodeURIComponent(JSON.stringify(value))
}

export function parseCustomPracticeCookie(value: string | undefined): CustomPracticeInput | null {
  if (!value) return null
  try { return parseCustomPracticeInput(JSON.parse(decodeURIComponent(value)) as unknown) } catch { return null }
}
