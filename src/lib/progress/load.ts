import {
  PRACTICE_MODES,
  PROMPT_SOURCES,
  type PracticeMode,
  type PromptSource,
} from '@/lib/practice/contracts'
import type { ProgressAttemptInput } from '@/lib/progress/v3-aggregation'
import { practiceCategoryFromValue } from '@/lib/practice/category'

export type ProgressAttemptRowsOutcome =
  | { status: 'ready'; attempts: readonly ProgressAttemptInput[] }
  | { status: 'failure'; reason: 'query' | 'invalid_response' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validScore(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100)
  )
}

function parseAttemptRow(value: unknown): ProgressAttemptInput | null {
  if (!isRecord(value)) return null
  if (
    value.status !== 'done' ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.finished_at !== 'string' ||
    !Number.isFinite(Date.parse(value.finished_at)) ||
    typeof value.prompt_text !== 'string' ||
    value.prompt_text.trim().length === 0 ||
    (value.retry_of_attempt_id !== null && typeof value.retry_of_attempt_id !== 'string') ||
    !validScore(value.score) ||
    !(PRACTICE_MODES as readonly unknown[]).includes(value.practice_mode) ||
    !(PROMPT_SOURCES as readonly unknown[]).includes(value.prompt_source) ||
    typeof value.rubric_version !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    finishedAt: value.finished_at,
    promptText: value.prompt_text,
    retryOfAttemptId: value.retry_of_attempt_id,
    score: value.score,
    sectionScores: value.section_scores,
    practiceMode: value.practice_mode as PracticeMode,
    promptSource: value.prompt_source as PromptSource,
    category:
      practiceCategoryFromValue(
        value.practice_category,
        value.practice_mode,
        value.prompt_source,
      ) ?? undefined,
    rubricVersion: value.rubric_version,
    status: 'done',
  }
}

/** Distinguishes a legitimate empty page from query and response failures. */
export function readProgressAttemptRows(
  data: unknown,
  queryFailed: boolean,
): ProgressAttemptRowsOutcome {
  if (queryFailed) return { status: 'failure', reason: 'query' }
  if (!Array.isArray(data)) return { status: 'failure', reason: 'invalid_response' }

  const attempts: ProgressAttemptInput[] = []
  for (const row of data) {
    const attempt = parseAttemptRow(row)
    if (!attempt) return { status: 'failure', reason: 'invalid_response' }
    attempts.push(attempt)
  }
  return { status: 'ready', attempts }
}

/** Returns only a bounded diagnostic code, never provider text or row contents. */
export function safeProgressErrorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== 'string') return undefined
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : undefined
}
