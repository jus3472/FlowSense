import {
  PRACTICE_MODES,
  PROMPT_DIFFICULTIES,
  PROMPT_SOURCES,
  type PracticeMode,
  type PromptDifficulty,
  type PromptSource,
} from '@/lib/practice/contracts'

export const MIN_TARGET_DURATION_SECONDS = 15
export const MAX_TARGET_DURATION_SECONDS = 600

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Plain data shared by server pages, client capture, and request validation. */
export interface PracticeSessionDescriptor {
  promptText: string
  promptId: string | null
  mode: PracticeMode
  difficulty: PromptDifficulty
  source: PromptSource
  targetDurationSeconds: number
  retryOfAttemptId: string | null
  additionalContext?: string
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function isTargetDuration(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_TARGET_DURATION_SECONDS &&
    value <= MAX_TARGET_DURATION_SECONDS
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validates source invariants before a descriptor becomes an attempt payload. */
export function parsePracticeSessionDescriptor(value: unknown): PracticeSessionDescriptor | null {
  if (!isRecord(value)) return null

  const promptText = typeof value.promptText === 'string' ? value.promptText.trim() : ''
  const promptId =
    value.promptId === null ? null : isUuid(value.promptId) ? value.promptId : undefined
  const retryOfAttemptId =
    value.retryOfAttemptId === null
      ? null
      : isUuid(value.retryOfAttemptId)
        ? value.retryOfAttemptId
        : undefined
  const additionalContext =
    typeof value.additionalContext === 'string' &&
    value.additionalContext.trim().length > 0 &&
    value.additionalContext.trim().length <= 1_000
      ? value.additionalContext.trim()
      : undefined

  if (
    promptText.length === 0 ||
    promptId === undefined ||
    retryOfAttemptId === undefined ||
    !includes(PRACTICE_MODES, value.mode) ||
    !includes(PROMPT_DIFFICULTIES, value.difficulty) ||
    !includes(PROMPT_SOURCES, value.source) ||
    !isTargetDuration(value.targetDurationSeconds)
  ) {
    return null
  }
  if (
    (value.source === 'library' && promptId === null) ||
    (value.source === 'custom' && promptId !== null)
  ) {
    return null
  }

  return {
    promptText,
    promptId,
    mode: value.mode,
    difficulty: value.difficulty,
    source: value.source,
    targetDurationSeconds: value.targetDurationSeconds,
    retryOfAttemptId,
    ...(additionalContext ? { additionalContext } : {}),
  }
}

/** Turns a stored attempt snapshot into a retry session without database or UI code. */
export function retrySessionFromAttempt(value: unknown): PracticeSessionDescriptor | null {
  if (!isRecord(value) || !isUuid(value.id)) return null

  const inferredSource: PromptSource =
    value.prompt_source === 'library' || value.prompt_source === 'custom'
      ? value.prompt_source
      : isUuid(value.prompt_id)
        ? 'library'
        : 'custom'

  return parsePracticeSessionDescriptor({
    promptText: value.prompt_text,
    promptId: inferredSource === 'library' ? value.prompt_id : null,
    mode: includes(PRACTICE_MODES, value.practice_mode) ? value.practice_mode : 'practice',
    difficulty: includes(PROMPT_DIFFICULTIES, value.prompt_difficulty)
      ? value.prompt_difficulty
      : 'beginner',
    source: inferredSource,
    // Attempts before session descriptors did not snapshot this value.
    targetDurationSeconds: isTargetDuration(value.target_duration_seconds)
      ? value.target_duration_seconds
      : 60,
    retryOfAttemptId: value.id,
    additionalContext:
      isRecord(value.metrics) &&
      isRecord(value.metrics.practice) &&
      typeof value.metrics.practice.additional_context === 'string'
        ? value.metrics.practice.additional_context
        : undefined,
  })
}
