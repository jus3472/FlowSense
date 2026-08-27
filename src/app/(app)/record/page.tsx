import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { RecordFlow } from '@/components/record/record-flow'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { isCustomPracticeMarker } from '@/lib/practice/custom'
import { CUSTOM_HANDOFF_HEADER, parseCustomPracticeHeader } from '@/lib/practice/custom-handoff'
import { parsePracticeMode, parseRecordPromptParam } from '@/lib/practice/navigation'
import { sanitizeFocusAreas } from '@/lib/focus-areas'
import {
  isUuid,
  parsePracticeSessionDescriptor,
  retrySessionFromAttempt,
  type PracticeSessionDescriptor,
} from '@/lib/practice/session'
import { getPromptById, pickPreferredPracticePrompt } from '@/lib/prompts/server'
import { practiceModePriority } from '@/lib/focus-areas'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Record',
}

/** A fresh prompt on every visit, never a cached one. */
export const dynamic = 'force-dynamic'

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
  const retry = params.retry
  let session: PracticeSessionDescriptor | null = null
  if (typeof retry === 'string' && isUuid(retry)) {
    const { data: sourceAttempt } = await supabase
      .from('attempts')
      .select(
        'id, prompt_id, prompt_text, practice_mode, prompt_source, prompt_difficulty, metrics',
      )
      .eq('id', retry)
      .eq('user_id', user.id)
      .maybeSingle()
    session = retrySessionFromAttempt(sourceAttempt)
  }

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
  }

  const requestedPromptId = parseRecordPromptParam(params.prompt)
  if (!session && requestedPromptId !== undefined) {
    const prompt = requestedPromptId ? await getPromptById(requestedPromptId) : null
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

    if (!session) {
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
  }

  if (!session) {
    // Chosen on the server so the prompt reaches the browser without being
    // rendered. The record screen keeps it hidden until the countdown starts.
    const requestedMode = parsePracticeMode(typeof params.mode === 'string' ? params.mode : null)
    const areas = sanitizeFocusAreas(
      (await supabase.from('profiles').select('focus_areas').eq('id', user.id).maybeSingle()).data
        ?.focus_areas ?? [],
    )
    const prompt = await pickPreferredPracticePrompt(
      requestedMode ? [requestedMode] : practiceModePriority(areas),
    )
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
        description="The prompt list could not be loaded. Check your connection and try again."
      >
        <RetryButton />
      </ErrorState>
    )
  }

  return <RecordFlow session={session} />
}
