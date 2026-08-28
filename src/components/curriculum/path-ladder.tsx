import Link from 'next/link'
import { CurriculumStars } from '@/components/curriculum/stars'
import { Card } from '@/components/ui/card'
import type {
  CurriculumChapterSummary,
  CurriculumLessonProgress,
  CurriculumPathProgress,
  PathSlug,
} from '@/lib/curriculum/contracts'
import { curriculumLessonHref } from '@/lib/curriculum/routes'
import { PASSING_SCORE } from '@/lib/curriculum/thresholds'
import { cn } from '@/lib/utils'

function chapterUnlockRequirement(
  chapters: readonly CurriculumChapterSummary[],
  index: number,
): string | null {
  const previous = chapters[index - 1]
  return previous ? `Pass the ${previous.chapter.title} checkpoint to unlock this chapter.` : null
}

function checkpointDescription(
  chapters: readonly CurriculumChapterSummary[],
  index: number,
): string {
  const next = chapters[index + 1]
  return next
    ? `This checkpoint unlocks ${next.chapter.title} when you pass with ${PASSING_SCORE}.`
    : `This checkpoint completes the path when you pass with ${PASSING_SCORE}.`
}

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

  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted text-sm font-medium">Locked</p>
      <p className="text-muted text-sm">Pass the previous lesson to unlock this one.</p>
    </div>
  )
}

function LessonCard({
  lesson,
  current,
  checkpointCopy,
  pathSlug,
}: {
  lesson: CurriculumLessonProgress
  current: boolean
  checkpointCopy: string | null
  pathSlug: PathSlug
}) {
  const content = (
    <div
      className={cn(
        'rounded-card flex min-w-0 flex-col gap-4 p-4',
        current
          ? 'border-accent bg-accent-soft border'
          : lesson.state === 'locked'
            ? 'bg-surface-sunken'
            : 'bg-surface',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="numeric text-muted text-xs">Lesson {lesson.lesson.position} of 10</p>
          <h3 className="text-foreground text-base font-medium break-words">
            {lesson.lesson.title}
          </h3>
        </div>
        {current || lesson.checkpoint ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {current ? (
              <span className="bg-surface text-foreground rounded-full px-3 py-1 text-xs font-medium">
                Current lesson
              </span>
            ) : null}
            {lesson.checkpoint ? (
              <span className="bg-highlight text-highlight-fg rounded-full px-3 py-1 text-xs font-medium">
                Checkpoint
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {checkpointCopy ? <p className="text-muted text-sm">{checkpointCopy}</p> : null}
      <LessonDetails lesson={lesson} />

      {lesson.state === 'locked' ? null : (
        <span className="text-accent min-h-11 self-start py-3 text-sm font-medium">
          {lesson.state === 'retry_required'
            ? 'Try Again'
            : lesson.state === 'available'
              ? 'Start'
              : 'View lesson'}
        </span>
      )}
    </div>
  )

  if (lesson.state === 'locked') {
    return <div aria-disabled="true">{content}</div>
  }

  return (
    <Link
      href={curriculumLessonHref(pathSlug, lesson.lesson.slug)}
      className="rounded-card block min-h-11 min-w-0"
      aria-current={current ? 'step' : undefined}
    >
      {content}
    </Link>
  )
}

export function CurriculumPathLadder({ progress }: { progress: CurriculumPathProgress }) {
  const currentChapter = progress.summary.currentChapter
    ? (progress.chapters.find(
        ({ chapter }) => chapter.id === progress.summary.currentChapter?.id,
      ) ?? null)
    : null
  const currentLessonId = progress.summary.currentLesson?.id ?? null

  return (
    <div className="flex min-w-0 flex-col gap-8 pt-4 pb-12">
      <header className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-muted text-sm">Practice path</p>
          <h1 className="prompt-display text-foreground text-2xl break-words">
            {progress.path.title}
          </h1>
        </div>

        <Card className="grid min-w-0 gap-6 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-muted text-sm">
              {progress.summary.pathComplete ? 'Status' : 'Current chapter'}
            </p>
            {progress.summary.pathComplete ? (
              <p className="text-foreground font-medium">Path complete</p>
            ) : (
              <>
                <p className="text-foreground font-medium break-words">
                  {currentChapter?.chapter.title}
                </p>
                <p className="numeric text-muted text-sm">
                  {currentChapter?.passedLessons ?? 0} / {currentChapter?.totalLessons ?? 10} passed
                </p>
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-muted text-sm">Path</p>
            <p className="numeric text-foreground font-medium">
              {progress.summary.passedLessons} / {progress.summary.totalLessons} passed
            </p>
            <p className="numeric text-muted text-sm">
              {progress.summary.earnedStars} / {progress.summary.maximumStars} stars
            </p>
          </div>
        </Card>
      </header>

      <div className="flex min-w-0 flex-col gap-12">
        {progress.chapters.map((chapter, chapterIndex) => {
          const requirement = chapterUnlockRequirement(progress.chapters, chapterIndex)
          const chapterLessons = progress.lessons.filter(
            (lesson) => lesson.lesson.chapterId === chapter.chapter.id,
          )

          return (
            <section key={chapter.chapter.id} className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <h2 className="text-foreground text-xl font-semibold break-words">
                    {chapter.chapter.title}
                  </h2>
                  <span className="numeric text-muted text-sm">
                    {chapter.passedLessons} / {chapter.totalLessons} passed
                  </span>
                </div>
                {!chapter.chapterUnlocked && requirement ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-muted text-sm font-medium">Chapter locked</p>
                    <p className="text-muted text-sm">{requirement}</p>
                  </div>
                ) : null}
              </div>

              <ol className="flex min-w-0 flex-col gap-4">
                {chapterLessons.map((lesson) => (
                  <li key={lesson.lesson.id} className="min-w-0">
                    <LessonCard
                      lesson={lesson}
                      current={lesson.lesson.id === currentLessonId}
                      pathSlug={progress.path.slug}
                      checkpointCopy={
                        lesson.checkpoint
                          ? checkpointDescription(progress.chapters, chapterIndex)
                          : null
                      }
                    />
                  </li>
                ))}
              </ol>
            </section>
          )
        })}
      </div>
    </div>
  )
}
