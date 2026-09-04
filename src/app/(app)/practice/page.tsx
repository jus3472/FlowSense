import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PracticeOverview } from '@/components/curriculum/practice-overview'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { loadAuthenticatedCurriculumOverview } from '@/lib/curriculum/server'

export const metadata: Metadata = {
  title: 'Tracks',
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
    <div className="flex flex-col pt-4 pb-12">
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
