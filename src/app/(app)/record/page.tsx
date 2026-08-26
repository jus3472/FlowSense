import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { RecordFlow } from '@/components/record/record-flow'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { pickPracticePrompt } from '@/lib/prompts/server'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Record',
}

/** A fresh prompt on every visit, never a cached one. */
export const dynamic = 'force-dynamic'

export default async function RecordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Chosen on the server so the prompt reaches the browser without being
  // rendered. The record screen keeps it hidden until the countdown starts.
  const prompt = await pickPracticePrompt()
  if (!prompt) {
    return (
      <ErrorState
        title="No prompt is available"
        description="The prompt list could not be loaded. Check your connection and try again."
      >
        <RetryButton />
      </ErrorState>
    )
  }

  return <RecordFlow promptId={prompt.id} promptText={prompt.text} />
}
