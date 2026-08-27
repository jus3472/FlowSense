import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { RecordFlow } from '@/components/record/record-flow'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { dataEmpty, dataFailure, dataReady } from '@/lib/data/outcome'
import { practiceModePriority, sanitizeFocusAreas } from '@/lib/focus-areas'
import { isCustomPracticeMarker } from '@/lib/practice/custom'
import { CUSTOM_HANDOFF_HEADER, parseCustomPracticeHeader } from '@/lib/practice/custom-handoff'
import { parseRecordModeParam } from '@/lib/practice/navigation'
import {
  invalidExplicitRecordIntent,
  resolveLibraryPromptSession,
  resolveRetrySession,
} from '@/lib/practice/resolution'
import {
  parsePracticeSessionDescriptor,
  type PracticeSessionDescriptor,
} from '@/lib/practice/session'
import { recentPromptIdsOrEmpty } from '@/lib/prompts/data'
import {
  getPromptById,
  getRecentCompletedLibraryPromptIds,
  pickRecordPrompt,
} from '@/lib/prompts/server'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Record',
}

/** A fresh prompt on every visit, never a cached one. */
export const dynamic = 'force-dynamic'

function safeErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'unknown'
  const code = error.code
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code) ? code : 'unknown'
}

function logSessionLoadFailure(operation: string, error: unknown): void {
  console.error('[practice] session data load failed', {
    operation,
    code: safeErrorCode(error),
  })
}

function CustomUnavailableState() {
  return (
    <ErrorState
      title="Your custom prompt is not available"
      description="Enter the prompt again to start this practice."
    >
      <ButtonLink href="/practice/custom" variant="secondary">
        Enter a custom prompt
      </ButtonLink>
    </ErrorState>
  )
}

export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{
    retry?: string | string[]
    prompt?: string | string[]
    custom?: string | string[]
    mode?: string | string[]
  }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  let session: PracticeSessionDescriptor | null = null
  const invalidIntent = invalidExplicitRecordIntent(params)

  if (invalidIntent === 'custom') return <CustomUnavailableState />

  const retryResolution =
    invalidIntent === 'retry'
      ? ({ status: 'unavailable' } as const)
      : await resolveRetrySession(params.retry, async (attemptId) => {
          const { data, error } = await supabase
            .from('attempts')
            .select(
              'id, prompt_id, prompt_text, practice_mode, prompt_source, prompt_difficulty, metrics',
            )
            .eq('id', attemptId)
            .eq('user_id', user.id)
            .maybeSingle()

          if (error) {
            logSessionLoadFailure('retry_attempt', error)
            return dataFailure()
          }
          return data ? dataReady(data) : dataEmpty()
        })

  if (retryResolution.status === 'failure') {
    return (
      <ErrorState
        title="Your retry did not load"
        description="The connection to your response failed. Try loading it again."
      >
        <RetryButton />
      </ErrorState>
    )
  }
  if (retryResolution.status === 'unavailable') {
    return (
      <ErrorState
        title="That retry is not available"
        description="Open one of your responses and choose Try again."
      >
        <ButtonLink href="/history" variant="secondary">
          View responses
        </ButtonLink>
      </ErrorState>
    )
  }
  session = retryResolution.status === 'ready' ? retryResolution.session : null

  if (!session && isCustomPracticeMarker(params.custom)) {
    // Proxy validates, user-binds, and clears the encrypted cookie before this
    // upstream-only header reaches the page.
    const custom = parseCustomPracticeHeader((await headers()).get(CUSTOM_HANDOFF_HEADER))
    session = custom
      ? parsePracticeSessionDescriptor({
          ...custom,
          promptId: null,
          difficulty: 'beginner',
          source: 'custom',
          retryOfAttemptId: null,
        })
      : null

    if (!session) {
      return <CustomUnavailableState />
    }
  }

  if (!session) {
    const promptResolution =
      invalidIntent === 'prompt'
        ? ({ status: 'unavailable' } as const)
        : await resolveLibraryPromptSession(params.prompt, getPromptById)
    if (promptResolution.status === 'failure') {
      return (
        <ErrorState
          title="That prompt did not load"
          description="The prompt library could not be loaded. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      )
    }
    if (promptResolution.status === 'unavailable') {
      return (
        <ErrorState
          title="That prompt is not available"
          description="Choose another prompt from the practice library."
        >
          <ButtonLink href="/practice" variant="secondary">
            Browse practice
          </ButtonLink>
        </ErrorState>
      )
    }
    session = promptResolution.status === 'ready' ? promptResolution.session : null
  }

  if (!session) {
    // Chosen on the server so the prompt reaches the browser without being
    // rendered. The record screen keeps it hidden until the countdown starts.
    const requestedMode = parseRecordModeParam(params.mode)
    if (requestedMode === null) {
      return (
        <ErrorState
          title="That practice mode is not available"
          description="Choose a supported mode from the practice library."
        >
          <ButtonLink href="/practice" variant="secondary">
            Browse practice
          </ButtonLink>
        </ErrorState>
      )
    }

    const [profileResult, recentPromptIdsResult] = await Promise.all([
      requestedMode
        ? Promise.resolve(null)
        : supabase.from('profiles').select('focus_areas').eq('id', user.id).maybeSingle(),
      getRecentCompletedLibraryPromptIds(user.id),
    ])
    if (profileResult?.error) {
      logSessionLoadFailure('profile_focus_areas', profileResult.error)
      return (
        <ErrorState
          title="Your prompt did not load"
          description="The practice list could not be loaded. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      )
    }

    const areas = sanitizeFocusAreas(profileResult?.data?.focus_areas ?? [])
    const promptOutcome = await pickRecordPrompt(
      requestedMode,
      requestedMode ? [] : practiceModePriority(areas),
      recentPromptIdsOrEmpty(recentPromptIdsResult),
    )
    if (promptOutcome.status === 'failure') {
      return (
        <ErrorState
          title="Your prompt did not load"
          description="The practice list could not be loaded. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      )
    }

    const prompt = promptOutcome.status === 'ready' ? promptOutcome.data : null
    session = prompt
      ? parsePracticeSessionDescriptor({
          promptText: prompt.text,
          promptId: prompt.id,
          mode: prompt.mode,
          difficulty: prompt.difficulty,
          source: 'library',
          targetDurationSeconds: prompt.targetDurationSeconds,
          retryOfAttemptId: null,
        })
      : null
  }

  if (!session) {
    return (
      <ErrorState
        title="No prompt is available"
        description="Choose a custom prompt, or return when more library prompts are available."
      >
        <ButtonLink href="/practice/custom" variant="secondary">
          Enter a custom prompt
        </ButtonLink>
      </ErrorState>
    )
  }

  return <RecordFlow session={session} />
}
