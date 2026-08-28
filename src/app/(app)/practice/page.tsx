import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PracticeOverview } from '@/components/curriculum/practice-overview'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { loadAuthenticatedCurriculumOverview } from '@/lib/curriculum/server'

export const metadata: Metadata = {
  title: 'Practice',
}

export default async function PracticePage() {
  const outcome = await loadAuthenticatedCurriculumOverview()
  if (outcome.status === 'unauthenticated') redirect('/login')
  const failureDescription =
    outcome.status === 'failure' &&
    (outcome.reason === 'invalid_response' || outcome.reason.startsWith('invalid_'))
      ? 'Your saved path information could not be read. Try loading it again.'
      : 'The connection to your practice paths failed. Try loading them again.'

  return (
    <div className="flex flex-col gap-8 pt-4 pb-12">
      <div className="flex flex-col gap-2">
        <h1 className="prompt-display text-foreground text-2xl">Practice</h1>
        <p className="text-muted text-base">Continue a path or choose a standalone prompt.</p>
      </div>

      {outcome.status === 'failure' ? (
        <ErrorState title="Your practice paths did not load" description={failureDescription}>
          <RetryButton />
        </ErrorState>
      ) : (
        <PracticeOverview overview={outcome.data} />
      )}
    </div>
  )
}
