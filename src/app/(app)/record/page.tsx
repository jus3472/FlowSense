import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { RecordFlow } from '@/components/record/record-flow'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { createClient } from '@/lib/supabase/server'
import { pickRandom } from '@/lib/utils'

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

  const { data: prompts, error } = await supabase
    .from('prompts')
    .select('id, text')
    .eq('active', true)

  if (error || !prompts || prompts.length === 0) {
    return (
      <ErrorState
        title="No prompt is available"
        description="The prompt list could not be loaded. Check your connection and try again."
      >
        <RetryButton />
      </ErrorState>
    )
  }

  // Chosen on the server so the prompt reaches the browser without being
  // rendered. The record screen keeps it hidden until the countdown starts.
  const prompt = pickRandom(prompts)
  if (!prompt) {
    return (
      <ErrorState
        title="No prompt is available"
        description="The prompt list came back empty. Try again in a moment."
      >
        <RetryButton />
      </ErrorState>
    )
  }

  return <RecordFlow promptId={prompt.id} promptText={prompt.text} />
}
