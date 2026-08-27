import type { DataOutcome } from '@/lib/data/outcome'
import { isCustomPracticeMarker } from '@/lib/practice/custom'
import { parseRecordPromptParam, parseRecordRetryParam } from '@/lib/practice/navigation'
import {
  parsePracticeSessionDescriptor,
  retrySessionFromAttempt,
  type PracticeSessionDescriptor,
} from '@/lib/practice/session'
import type { LibraryPrompt } from '@/lib/prompts/selection'
import { isRetryableAttemptStatus } from '@/lib/attempts/lifecycle'

type SearchParam = string | string[] | undefined

export interface RecordSearchParams {
  retry?: SearchParam
  prompt?: SearchParam
  custom?: SearchParam
  mode?: SearchParam
}

export type ExplicitSessionResolution =
  | { status: 'none' }
  | { status: 'ready'; session: PracticeSessionDescriptor }
  | { status: 'unavailable' }
  | { status: 'failure' }

export function invalidExplicitRecordIntent(
  params: RecordSearchParams,
): 'retry' | 'prompt' | 'custom' | null {
  if (
    params.custom !== undefined &&
    (!isCustomPracticeMarker(params.custom) ||
      params.retry !== undefined ||
      params.prompt !== undefined ||
      params.mode !== undefined)
  ) {
    return 'custom'
  }
  if (params.retry !== undefined && (params.prompt !== undefined || params.mode !== undefined)) {
    return 'retry'
  }
  if (params.prompt !== undefined && params.mode !== undefined) {
    return 'prompt'
  }
  return null
}

/**
 * Resolves explicit retry intent before every other record path. Once a retry
 * key is present, no malformed value or contradictory query can become an
 * ordinary prompt request.
 */
export async function resolveExplicitRetryIntent(
  params: RecordSearchParams,
  loadAttempt: (attemptId: string) => Promise<DataOutcome<unknown>>,
): Promise<ExplicitSessionResolution> {
  if (params.retry === undefined) return { status: 'none' }
  if (params.prompt !== undefined || params.custom !== undefined || params.mode !== undefined) {
    return { status: 'unavailable' }
  }

  const resolution = await resolveRetrySession(params.retry, loadAttempt)
  return resolution.status === 'none' ? { status: 'unavailable' } : resolution
}

export async function resolveRetrySession(
  value: SearchParam,
  loadAttempt: (attemptId: string) => Promise<DataOutcome<unknown>>,
): Promise<ExplicitSessionResolution> {
  const attemptId = parseRecordRetryParam(value)
  if (attemptId === undefined) return { status: 'none' }
  if (attemptId === null) return { status: 'unavailable' }

  const outcome = await loadAttempt(attemptId)
  if (outcome.status === 'failure') return { status: 'failure' }
  if (outcome.status === 'empty') return { status: 'unavailable' }

  if (
    typeof outcome.data !== 'object' ||
    outcome.data === null ||
    !isRetryableAttemptStatus(Reflect.get(outcome.data, 'status'))
  ) {
    return { status: 'unavailable' }
  }

  const session = retrySessionFromAttempt(outcome.data)
  return session ? { status: 'ready', session } : { status: 'unavailable' }
}

export async function resolveLibraryPromptSession(
  value: SearchParam,
  loadPrompt: (promptId: string) => Promise<DataOutcome<LibraryPrompt>>,
): Promise<ExplicitSessionResolution> {
  const promptId = parseRecordPromptParam(value)
  if (promptId === undefined) return { status: 'none' }
  if (promptId === null) return { status: 'unavailable' }

  const outcome = await loadPrompt(promptId)
  if (outcome.status === 'failure') return { status: 'failure' }
  if (outcome.status === 'empty') return { status: 'unavailable' }

  const prompt = outcome.data
  const session = parsePracticeSessionDescriptor({
    promptText: prompt.text,
    promptId: prompt.id,
    mode: prompt.mode,
    difficulty: prompt.difficulty,
    source: 'library',
    targetDurationSeconds: prompt.targetDurationSeconds,
    retryOfAttemptId: null,
  })
  return session ? { status: 'ready', session } : { status: 'failure' }
}
