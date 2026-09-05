import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PracticeOverview } from '@/components/curriculum/practice-overview'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { PageTitle } from '@/components/ui/page-title'
import { PageShell } from '@/components/ui/page-shell'
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
    <div>
      {outcome.status === 'failure' ? (
        <PageShell>
          <PageTitle>Tracks</PageTitle>
          <ErrorState title="Your practice paths did not load" description={failureDescription}>
            <RetryButton />
          </ErrorState>
        </PageShell>
      ) : (
        <PracticeOverview overview={outcome.data} />
      )}
    </div>
  )
}
