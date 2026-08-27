import { PRACTICE_MODES, type PracticeMode } from '@/lib/practice/contracts'

export const MAX_CUSTOM_PROMPT_LENGTH = 1_000
export const MAX_CUSTOM_CONTEXT_LENGTH = 1_000
/** Leaves room for the authenticated-encryption envelope and cookie attributes. */
export const MAX_CUSTOM_HANDOFF_INPUT_BYTES = 2_300
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
  return [...result].length <= limit ? result : null
}

export type CustomPracticeInputResult =
  { ok: true; value: CustomPracticeInput } | { ok: false; reason: 'invalid' | 'too_large' }

function storageBytes(value: CustomPracticeInput): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function validateCustomPracticeInput(value: unknown): CustomPracticeInputResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, reason: 'invalid' }
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
  )
    return { ok: false, reason: 'invalid' }
  const input: CustomPracticeInput = {
    promptText,
    mode: mode as PracticeMode,
    ...(context ? { additionalContext: context } : {}),
    targetDurationSeconds,
  }
  return storageBytes(input) <= MAX_CUSTOM_HANDOFF_INPUT_BYTES
    ? { ok: true, value: input }
    : { ok: false, reason: 'too_large' }
}

export function parseCustomPracticeInput(value: unknown): CustomPracticeInput | null {
  const result = validateCustomPracticeInput(value)
  return result.ok ? result.value : null
}

export const CUSTOM_SESSION_COOKIE = 'flowsense_custom_session'

/** A custom session is only consumed after the action's explicit redirect. */
export function isCustomPracticeMarker(value: unknown): boolean {
  return value === '1'
}
