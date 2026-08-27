import type { DataOutcome } from '@/lib/data/outcome'
import { isCustomPracticeMarker } from '@/lib/practice/custom'
import { parseRecordPromptParam, parseRecordRetryParam } from '@/lib/practice/navigation'
import {
  parsePracticeSessionDescriptor,
  retrySessionFromAttempt,
  type PracticeSessionDescriptor,
} from '@/lib/practice/session'
import type { LibraryPrompt } from '@/lib/prompts/selection'

type SearchParam = string | string[] | undefined

export type ExplicitSessionResolution =
  | { status: 'none' }
  | { status: 'ready'; session: PracticeSessionDescriptor }
  | { status: 'unavailable' }
  | { status: 'failure' }

export function invalidExplicitRecordIntent(params: {
  retry?: SearchParam
  prompt?: SearchParam
  custom?: SearchParam
  mode?: SearchParam
}): 'retry' | 'prompt' | 'custom' | null {
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
