import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CurriculumPathLadder } from '@/components/curriculum/path-ladder'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { PageShell } from '@/components/ui/page-shell'
import type { CurriculumPathProgress } from '@/lib/curriculum/contracts'
import { loadAuthenticatedCurriculumPath } from '@/lib/curriculum/server'

export const metadata: Metadata = {
  title: 'Practice Path',
}

function hasInactiveCurriculum(progress: CurriculumPathProgress): boolean {
  return (
    !progress.path.active ||
    progress.chapters.some(
      ({ chapter }) => !chapter.active || chapter.lessons.some((lesson) => !lesson.active),
    )
  )
}

export default async function CurriculumPathPage({
  params,
}: {
  params: Promise<{ pathSlug: string }>
}) {
  const { pathSlug } = await params
  const outcome = await loadAuthenticatedCurriculumPath(pathSlug)

  if (outcome.status === 'unauthenticated') redirect('/login')
  if (outcome.status === 'not_found') notFound()

  if (outcome.status === 'failure') {
    return (
      <PageShell width="reading" className="gap-8">
        <h1 className="prompt-display text-foreground text-2xl">Practice path</h1>
        <ErrorState
          title="This path did not load"
          description="The connection to your path failed. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      </PageShell>
    )
  }

  if (hasInactiveCurriculum(outcome.data)) {
    return (
      <PageShell width="reading" className="gap-8">
        <h1 className="prompt-display text-foreground text-2xl">Practice path</h1>
        <ErrorState
          title="This path is not available"
          description="This path is not available for practice right now."
        />
      </PageShell>
    )
  }

  return <CurriculumPathLadder progress={outcome.data} />
}
