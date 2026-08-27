import type { ProgressRetryAttemptInput } from '@/lib/progress/retries'

export type ProgressAttemptRowsOutcome =
  | { status: 'ready'; attempts: readonly ProgressRetryAttemptInput[]; truncated: boolean }
  | { status: 'failure'; reason: 'query' | 'invalid_response' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAttemptRow(value: unknown): ProgressRetryAttemptInput | null {
  if (!isRecord(value)) return null
  if (value.status !== 'done') return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  if (typeof value.created_at !== 'string') return null
  if (value.retry_of_attempt_id !== null && typeof value.retry_of_attempt_id !== 'string') {
    return null
  }

  return {
    id: value.id,
    createdAt: value.created_at,
    retryOfAttemptId: value.retry_of_attempt_id,
    sectionScores: value.section_scores,
  }
}

/**
 * Keeps a legitimate empty query distinct from failure and removes the final
 * lookahead row from a newest-first bounded response.
 */
export function readProgressAttemptRows(
  data: unknown,
  queryFailed: boolean,
  includedAttemptLimit: number,
): ProgressAttemptRowsOutcome {
  if (queryFailed) return { status: 'failure', reason: 'query' }
  if (!Array.isArray(data)) return { status: 'failure', reason: 'invalid_response' }
  if (!Number.isSafeInteger(includedAttemptLimit) || includedAttemptLimit < 1) {
    return { status: 'failure', reason: 'invalid_response' }
  }

  const attempts: ProgressRetryAttemptInput[] = []
  for (const row of data) {
    const attempt = parseAttemptRow(row)
    if (!attempt) return { status: 'failure', reason: 'invalid_response' }
    attempts.push(attempt)
  }
  return {
    status: 'ready',
    attempts: attempts.slice(0, includedAttemptLimit),
    truncated: attempts.length > includedAttemptLimit,
  }
}

/** Returns only a bounded diagnostic code, never provider text or row contents. */
export function safeProgressErrorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== 'string') return undefined
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : undefined
}
