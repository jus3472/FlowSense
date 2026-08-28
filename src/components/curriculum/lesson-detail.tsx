import Link from 'next/link'
import { CurriculumStars } from '@/components/curriculum/stars'
import { RetryButton } from '@/components/system/retry-button'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import type { CurriculumLessonAccessOutcome } from '@/lib/curriculum/server'
import { curriculumPathHref } from '@/lib/curriculum/routes'
import { formatExpectedDuration } from '@/lib/practice/navigation'

type AllowedLessonData = Extract<CurriculumLessonAccessOutcome, { status: 'allowed' }>['data']
type DeniedLessonReason = Extract<CurriculumLessonAccessOutcome, { status: 'denied' }>['reason']

const PATH_NAMES: Record<AllowedLessonData['session']['mode'], string> = {
  practice: 'General Speaking',
  interview: 'Interviews',
  presentation: 'Presentations',
  conversation: 'Conversations',
}

const STATE_LABELS = {
  available: 'Available',
  retry_required: 'Retry required',
  passed: 'Passed',
} as const

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function targetDuration(seconds: number): string {
  return formatExpectedDuration(seconds).toLowerCase()
}

function actionLabel(state: AllowedLessonData['lesson']['state']): string | null {
  if (state === 'available') return 'Start Lesson'
  if (state === 'retry_required') return 'Try Again'
  if (state === 'passed') return 'Practice Again'
  return null
}

function authoritativePathSlug(data: AllowedLessonData) {
  const link = data.lesson.previousLesson ?? data.lesson.nextLesson
  if (!link) {
    throw new Error('Curriculum lesson is missing its path navigation context.')
  }
  return link.pathSlug
}

export function CurriculumLessonDetail({ data }: { data: AllowedLessonData }) {
  const { lesson, session } = data
  const pathName = PATH_NAMES[session.mode]
  const chapterName = titleCase(session.difficulty)
  const label = actionLabel(lesson.state)
  const pathSlug = authoritativePathSlug(data)

  return (
    <article className="flex min-w-0 flex-col gap-8 pt-4 pb-12">
      <header className="flex min-w-0 flex-col gap-3">
        <Link
          href={curriculumPathHref(pathSlug)}
          className="text-accent inline-flex min-h-11 w-fit items-center text-sm hover:underline"
        >
          {pathName}
        </Link>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-muted text-sm">
            {chapterName} · Lesson {lesson.lesson.position} of 10
          </p>
          <h1 className="prompt-display text-foreground text-2xl break-words">
            {lesson.lesson.title}
          </h1>
          <p className="text-muted text-base break-words">{lesson.lesson.skillFocus}</p>
        </div>
      </header>

      <Card className="flex min-w-0 flex-col gap-4">
        <h2 className="section-label text-muted">Your prompt</h2>
        <p className="text-foreground text-lg break-words">{session.promptText}</p>
        <div className="text-muted flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <span>Target: {targetDuration(session.targetDurationSeconds)}</span>
          <span>Pass: 70</span>
        </div>
      </Card>

      <Card className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="section-label text-muted">Lesson state</h2>
            <p className="text-foreground font-medium">
              {lesson.state === 'locked' ? 'Locked' : STATE_LABELS[lesson.state]}
            </p>
          </div>
          {lesson.attemptStatus === 'scored' && lesson.bestScore !== null ? (
            <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
              <span className="text-foreground">
                Best: <span className="numeric">{lesson.bestScore}</span>
              </span>
              <CurriculumStars stars={lesson.stars} />
            </div>
          ) : null}
        </div>

        {lesson.state === 'retry_required' ? (
          <p className="text-muted text-sm">Need 70 to continue.</p>
        ) : null}
        {lesson.attemptStatus === 'neutral' ? (
          <p className="text-muted text-sm">You have activity here, but no score.</p>
        ) : null}

        {label ? (
          <div className="flex flex-col gap-2">
            <Button fullWidth disabled aria-describedby="curriculum-recording-status">
              {label}
            </Button>
            <p id="curriculum-recording-status" className="text-muted text-sm">
              Lesson recording is not available from this page yet.
            </p>
          </div>
        ) : null}
      </Card>
    </article>
  )
}

export function CurriculumLessonDeniedState({ reason }: { reason: DeniedLessonReason }) {
  if (reason === 'locked') {
    return (
      <div className="flex flex-col gap-8 pt-4 pb-12">
        <ErrorState
          title="Lesson locked"
          description="Pass the previous lesson to unlock this lesson."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 pt-4 pb-12">
      <ErrorState
        title="Lesson unavailable"
        description={
          reason === 'path_mismatch'
            ? 'This lesson does not belong to this path.'
            : 'This lesson is not available.'
        }
      />
    </div>
  )
}

export function CurriculumLessonFailureState() {
  return (
    <div className="flex flex-col gap-8 pt-4 pb-12">
      <ErrorState
        title="Lesson did not load"
        description="The lesson could not be loaded. Try again in a moment."
      >
        <RetryButton />
      </ErrorState>
    </div>
  )
}
