import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { PageShell } from '@/components/ui/page-shell'
import type { CurriculumLessonAccessOutcome } from '@/lib/curriculum/server'

type DeniedLessonReason = Extract<CurriculumLessonAccessOutcome, { status: 'denied' }>['reason']

export function CurriculumLessonDeniedState({ reason }: { reason: DeniedLessonReason }) {
  if (reason === 'locked') {
    return (
      <PageShell width="column" className="gap-8">
        <ErrorState
          title="Lesson locked"
          description="Pass the previous lesson to unlock this lesson."
        />
      </PageShell>
    )
  }

  return (
    <PageShell width="column" className="gap-8">
      <ErrorState
        title="Lesson unavailable"
        description={
          reason === 'path_mismatch'
            ? 'This lesson does not belong to this path.'
            : 'This lesson is not available.'
        }
      />
    </PageShell>
  )
}

export function CurriculumLessonFailureState() {
  return (
    <PageShell width="column" className="gap-8">
      <ErrorState
        title="Lesson did not load"
        description="The lesson could not be loaded. Try again in a moment."
      >
        <RetryButton />
      </ErrorState>
    </PageShell>
  )
}
