import Link from 'next/link'
import { CurriculumStars } from '@/components/curriculum/stars'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { ScoreProgress } from '@/components/ui/score-progress'
import type {
  CurriculumLessonProgress,
  CurriculumPathProgress,
  PathSlug,
} from '@/lib/curriculum/contracts'
import { attemptResultHref, curriculumLessonRecordHref } from '@/lib/curriculum/routes'
import { PASSING_SCORE } from '@/lib/curriculum/thresholds'
import { cn } from '@/lib/utils'

function LessonDetails({ lesson }: { lesson: CurriculumLessonProgress }) {
  if (lesson.state === 'passed') {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <CurriculumStars stars={lesson.stars} />
        <span className="numeric text-foreground">Best {lesson.bestScore}</span>
        <span className="text-positive font-medium">Passed</span>
      </div>
    )
  }

  if (lesson.state === 'retry_required') {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <CurriculumStars stars={0} />
        <span className="numeric text-foreground">Best {lesson.bestScore}</span>
        <span className="numeric text-muted">Need {PASSING_SCORE}</span>
      </div>
    )
  }

  if (lesson.state === 'available') {
    return (
      <p className="text-muted text-sm">
        {lesson.attemptStatus === 'neutral' ? 'No score yet' : 'Not attempted'}
      </p>
    )
  }

  return <p className="text-muted text-sm font-medium">Locked</p>
}

function LessonCard({
  lesson,
  current,
  pathSlug,
}: {
  lesson: CurriculumLessonProgress
  current: boolean
  pathSlug: PathSlug
}) {
  const content = (
    <div
      className={cn(
        'border-border shadow-card rounded-card flex min-w-0 flex-col gap-4 border p-4',
        current
          ? 'border-accent bg-accent-soft'
          : lesson.state === 'locked'
            ? 'bg-surface-sunken'
            : 'bg-surface',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3
            aria-label={
              lesson.checkpoint ? `Lesson ${lesson.lesson.position}, checkpoint` : undefined
            }
            className="numeric text-foreground text-base font-medium"
          >
            Lesson {lesson.lesson.position}
          </h3>
        </div>
        {current ? (
          <span className="bg-surface text-foreground shrink-0 rounded-full px-3 py-1 text-xs font-medium">
            Current lesson
          </span>
        ) : null}
      </div>

      <LessonDetails lesson={lesson} />

      {lesson.state === 'locked' ? null : (
        <span className="text-accent min-h-11 self-start py-3 text-sm font-medium">
          {lesson.state === 'retry_required'
            ? 'Try Again'
            : lesson.state === 'available'
              ? 'Start'
              : lesson.bestAttemptId
                ? 'View Best Result'
                : 'Practice Again'}
        </span>
      )}
    </div>
  )

  if (lesson.state === 'locked') {
    return <div aria-disabled="true">{content}</div>
  }

  return (
    <Link
      href={
        lesson.state === 'passed' && lesson.bestAttemptId
          ? attemptResultHref(lesson.bestAttemptId)
          : curriculumLessonRecordHref(
              pathSlug,
              lesson.lesson.slug,
              lesson.state === 'retry_required' ? lesson.bestAttemptId : null,
            )
      }
      className="rounded-card block min-h-11 min-w-0"
      aria-current={current ? 'step' : undefined}
    >
      {content}
    </Link>
  )
}

export function CurriculumPathLadder({ progress }: { progress: CurriculumPathProgress }) {
  const currentLessonId = progress.summary.currentLesson?.id ?? null

  return (
    <PageShell width="reading" className="gap-8">
      <header className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-muted text-sm">Track</p>
          <h1 className="prompt-display text-foreground text-2xl break-words">
            {progress.path.title}
          </h1>
        </div>

        <Card className="flex min-w-0 flex-col gap-6 sm:p-8">
          <ScoreProgress
            label={`${progress.path.title} lesson progress`}
            value={progress.summary.passedLessons}
            max={progress.summary.totalLessons}
            size="section"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-muted text-sm">Track</p>
            <p className="numeric text-foreground font-medium">
              {progress.summary.passedLessons} / {progress.summary.totalLessons} passed
            </p>
            <p className="numeric text-muted text-sm">
              {progress.summary.earnedStars} / {progress.summary.maximumStars} stars
            </p>
            {progress.summary.pathComplete ? (
              <p className="text-positive pt-2 text-sm font-medium">Track complete</p>
            ) : null}
          </div>
        </Card>
      </header>

      <div className="flex min-w-0 flex-col gap-12">
        {progress.chapters.map((chapter) => {
          const chapterLessons = progress.lessons.filter(
            (lesson) => lesson.lesson.chapterId === chapter.chapter.id,
          )

          return (
            <section key={chapter.chapter.id} className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h2 className="text-foreground text-xl font-semibold break-words">
                  {chapter.chapter.title}
                </h2>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {!chapter.chapterUnlocked ? (
                    <span className="text-muted text-sm font-medium">Chapter locked</span>
                  ) : null}
                  <span className="numeric text-muted text-sm">
                    {chapter.passedLessons} / {chapter.totalLessons} passed
                  </span>
                </div>
              </div>

              <ol className="flex min-w-0 flex-col gap-4">
                {chapterLessons.map((lesson) => (
                  <li key={lesson.lesson.id} className="min-w-0">
                    <LessonCard
                      lesson={lesson}
                      current={lesson.lesson.id === currentLessonId}
                      pathSlug={progress.path.slug}
                    />
                  </li>
                ))}
              </ol>
            </section>
          )
        })}
      </div>
    </PageShell>
  )
}
