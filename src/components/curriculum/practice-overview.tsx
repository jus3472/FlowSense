import Link from 'next/link'
import { CurriculumStars } from '@/components/curriculum/stars'
import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'
import { ScoreProgress } from '@/components/ui/score-progress'
import type { CurriculumLessonProgress, CurriculumPathProgress } from '@/lib/curriculum/contracts'
import type { CurriculumOverviewData } from '@/lib/curriculum/overview'
import { curriculumLessonRecordHref, curriculumPathHref } from '@/lib/curriculum/routes'

function currentLesson(progress: CurriculumPathProgress): CurriculumLessonProgress | null {
  const lessonId = progress.summary.currentLesson?.id
  return lessonId ? (progress.lessons.find((item) => item.lesson.id === lessonId) ?? null) : null
}

function pathAction(progress: CurriculumPathProgress): {
  label: 'Start' | 'Continue' | 'Try Again' | 'View Path'
  href: ReturnType<typeof curriculumPathHref> | ReturnType<typeof curriculumLessonRecordHref>
} {
  const action = progress.summary.nextAction
  if (action.kind === 'complete') {
    return { label: 'View Path', href: curriculumPathHref(progress.path.slug) }
  }
  const lesson = currentLesson(progress)
  const href = curriculumLessonRecordHref(
    progress.path.slug,
    action.lesson.slug,
    action.kind === 'retry' ? lesson?.bestAttemptId : null,
  )
  if (action.kind === 'retry') return { label: 'Try Again', href }
  return {
    label: progress.summary.attemptedLessons === 0 ? 'Start' : 'Continue',
    href,
  }
}

function PathCard({ item }: { item: CurriculumOverviewData['paths'][number] }) {
  const { progress, selection } = item
  const lesson = currentLesson(progress)
  const chapter = progress.chapters.find(
    (chapterProgress) => chapterProgress.chapter.id === lesson?.lesson.chapterId,
  )
  const action = pathAction(progress)

  return (
    <Card className="hover:bg-surface-sunken relative flex min-w-0 flex-col gap-6 transition duration-150 ease-out sm:p-8">
      <Link
        href={curriculumPathHref(progress.path.slug)}
        aria-label={`View ${progress.path.title} track`}
        className="rounded-card focus-visible:ring-accent focus-visible:ring-offset-background absolute inset-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2"
      />

      <h2 className="text-foreground min-w-0 text-lg font-semibold break-words">
        {progress.path.title}
      </h2>

      {progress.summary.pathComplete ? (
        <p className="text-positive text-sm font-medium">Path complete</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-foreground text-sm font-medium">
            {chapter?.chapter.title ?? 'Current chapter'}
          </p>
          <p className="numeric text-muted text-sm">
            {chapter?.passedLessons ?? 0} / {chapter?.totalLessons ?? 10} passed
          </p>
        </div>
      )}

      <div className="text-muted flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span className="numeric">
          {progress.summary.passedLessons} / {progress.summary.totalLessons} passed
        </span>
        <span className="numeric">
          {progress.summary.earnedStars} / {progress.summary.maximumStars} stars
        </span>
      </div>

      <ScoreProgress
        label={`${progress.path.title} lesson progress`}
        value={progress.summary.passedLessons}
        max={progress.summary.totalLessons}
        size="section"
      />

      {lesson ? (
        <div className="border-border flex min-w-0 flex-col gap-2 border-t pt-4">
          <p className="text-muted text-xs font-medium">
            {lesson.checkpoint ? 'Current checkpoint' : 'Current lesson'}
          </p>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="numeric text-foreground min-w-0 text-base font-medium">
              Lesson {lesson.lesson.position} of {chapter?.totalLessons ?? 10}
            </p>
            <CurriculumStars stars={lesson.stars} />
          </div>
          {lesson.state === 'retry_required' && lesson.bestScore !== null ? (
            <p className="numeric text-muted text-sm">Best {lesson.bestScore} · Need 70</p>
          ) : lesson.attemptStatus === 'neutral' ? (
            <p className="text-muted text-sm">You have activity here, but no score.</p>
          ) : (
            <p className="text-muted text-sm">Not passed yet</p>
          )}
        </div>
      ) : null}

      <ButtonLink
        href={action.href}
        fullWidth
        variant={selection === 'primary' ? 'primary' : 'secondary'}
        className="relative z-10"
      >
        {action.label}
      </ButtonLink>
    </Card>
  )
}

export function PracticeOverview({ overview }: { overview: CurriculumOverviewData }) {
  return (
    <PageShell>
      <PageTitle id="tracks-heading">Tracks</PageTitle>
      <section aria-labelledby="tracks-heading" className="flex flex-col gap-4">
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
