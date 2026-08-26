import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { RecordFlow } from '@/components/record/record-flow'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { pickPracticePrompt } from '@/lib/prompts/server'
import {
  isUuid,
  parsePracticeSessionDescriptor,
  retrySessionFromAttempt,
  type PracticeSessionDescriptor,
} from '@/lib/practice/session'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Record',
}

/** A fresh prompt on every visit, never a cached one. */
export const dynamic = 'force-dynamic'

export default async function RecordPage({
  searchParams,
}: {
  searchParams: Promise<{ retry?: string | string[] }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const retry = (await searchParams).retry
  let session: PracticeSessionDescriptor | null = null
  if (typeof retry === 'string' && isUuid(retry)) {
    const { data: sourceAttempt } = await supabase
      .from('attempts')
      .select('id, prompt_id, prompt_text, practice_mode, prompt_source, prompt_difficulty')
      .eq('id', retry)
      .eq('user_id', user.id)
      .maybeSingle()
    session = retrySessionFromAttempt(sourceAttempt)
  }

  if (!session) {
    // Chosen on the server so the prompt reaches the browser without being
    // rendered. The record screen keeps it hidden until the countdown starts.
    const prompt = await pickPracticePrompt()
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
