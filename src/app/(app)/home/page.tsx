import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { HomeOverview } from '@/components/curriculum/home-overview'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'
import { loadAuthenticatedCurriculumOverview } from '@/lib/curriculum/server'

export const metadata: Metadata = {
  title: 'Home',
}

export default async function HomePage() {
  const outcome = await loadAuthenticatedCurriculumOverview()
  if (outcome.status === 'unauthenticated') redirect('/login')
  const failureDescription =
    outcome.status === 'failure' &&
    (outcome.reason === 'invalid_response' || outcome.reason.startsWith('invalid_'))
      ? 'Your saved path information could not be read. Try loading it again.'
      : 'The connection to your practice paths failed. Try loading them again.'

  if (outcome.status === 'ready') return <HomeOverview overview={outcome.data} />

  return (
    <PageShell>
      <PageTitle>Home</PageTitle>
      <ErrorState title="Your practice paths did not load" description={failureDescription}>
        <RetryButton />
      </ErrorState>
    </PageShell>
  )
}
