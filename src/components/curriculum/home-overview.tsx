import { TrackIcon } from '@/components/curriculum/track-identity'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'
import type { CurriculumLessonProgress, CurriculumPathProgress } from '@/lib/curriculum/contracts'
import type { CurriculumOverviewData } from '@/lib/curriculum/overview'
import { curriculumLessonRecordHref, curriculumPathHref } from '@/lib/curriculum/routes'
import { TRACK_IDENTITIES } from '@/lib/curriculum/track-identity'

function currentLesson(progress: CurriculumPathProgress): CurriculumLessonProgress | null {
  const lessonId = progress.summary.currentLesson?.id
  return lessonId ? (progress.lessons.find((item) => item.lesson.id === lessonId) ?? null) : null
}

function pathAction(progress: CurriculumPathProgress): {
  label: 'Start Lesson' | 'Try Again' | 'Next Lesson' | 'Practice Again'
  href: ReturnType<typeof curriculumPathHref> | ReturnType<typeof curriculumLessonRecordHref>
} {
  const action = progress.summary.nextAction
  if (action.kind === 'complete') {
    const firstLesson = progress.lessons[0]
    return firstLesson
      ? {
          label: 'Practice Again',
          href: curriculumLessonRecordHref(
            progress.path.slug,
            firstLesson.lesson.slug,
            firstLesson.bestAttemptId,
          ),
        }
      : { label: 'Practice Again', href: curriculumPathHref(progress.path.slug) }
  }
  const lesson = currentLesson(progress)
  const href = curriculumLessonRecordHref(
    progress.path.slug,
    action.lesson.slug,
    action.kind === 'retry' ? lesson?.bestAttemptId : null,
  )
  return {
    label:
      action.kind === 'retry' || lesson?.attempted
        ? 'Try Again'
        : progress.summary.passedLessons > 0
          ? 'Next Lesson'
          : 'Start Lesson',
    href,
  }
}

function PathCard({ item }: { item: CurriculumOverviewData['paths'][number] }) {
  const { progress } = item
  const identity = TRACK_IDENTITIES[progress.path.slug]
  const lesson = currentLesson(progress)
  const chapter = progress.chapters.find(
    (chapterProgress) => chapterProgress.chapter.id === lesson?.lesson.chapterId,
  )
  const action = pathAction(progress)
  const headingId = `track-${progress.path.slug}-heading`

  return (
    <Card role="article" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-6 sm:p-8">
      <div className="flex min-w-0 items-start gap-4">
        <span className="bg-accent text-accent-fg flex size-12 shrink-0 items-center justify-center rounded-full">
          <TrackIcon slug={progress.path.slug} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="text-foreground min-w-0 text-lg font-semibold break-words">
            {identity.title}
          </h2>
          <p className="text-muted text-sm">{identity.description}</p>
        </div>
      </div>

      {lesson ? (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-muted text-xs font-medium">Current lesson</p>
          <p className="numeric text-foreground min-w-0 text-base font-medium">
            Lesson {lesson.lesson.position} of {chapter?.totalLessons ?? 10}
          </p>
        </div>
      ) : (
        <p className="text-positive text-sm font-medium">Path complete</p>
      )}

      <div className="mt-auto grid gap-3 sm:grid-cols-2">
        <ButtonLink href={action.href} fullWidth>
          {action.label}
        </ButtonLink>
        <ButtonLink href={curriculumPathHref(progress.path.slug)} fullWidth variant="secondary">
          View Lessons
        </ButtonLink>
      </div>
    </Card>
  )
}

export function HomeOverview({ overview }: { overview: CurriculumOverviewData }) {
  return (
    <PageShell>
      <PageTitle id="home-heading">Home</PageTitle>
      <section aria-labelledby="home-heading" className="flex flex-col gap-4">
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          {overview.paths.map((item) => (
            <PathCard key={item.progress.path.id} item={item} />
          ))}
        </div>
      </section>

      <section aria-labelledby="custom-prompt-heading">
        <Card className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="flex flex-col gap-2">
            <h2 id="custom-prompt-heading" className="text-foreground text-lg font-semibold">
              Custom Prompt
            </h2>
            <p className="text-muted text-sm">Practice with your own custom prompt</p>
          </div>
          <ButtonLink href="/practice/custom" variant="secondary">
            Enter a custom prompt
          </ButtonLink>
        </Card>
      </section>
    </PageShell>
  )
}
