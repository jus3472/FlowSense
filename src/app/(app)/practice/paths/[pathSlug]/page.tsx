import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CurriculumPathLadder } from '@/components/curriculum/path-ladder'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
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
      <div className="flex flex-col gap-8 pt-4 pb-12">
        <h1 className="prompt-display text-foreground text-2xl">Practice path</h1>
        <ErrorState
          title="This path did not load"
          description="The connection to your path failed. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      </div>
    )
  }

  if (hasInactiveCurriculum(outcome.data)) {
    return (
      <div className="flex flex-col gap-8 pt-4 pb-12">
        <h1 className="prompt-display text-foreground text-2xl">Practice path</h1>
        <ErrorState
          title="This path is not available"
          description="This path is not available for practice right now."
        />
      </div>
    )
  }

  return <CurriculumPathLadder progress={outcome.data} />
}
