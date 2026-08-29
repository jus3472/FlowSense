import Link from 'next/link'
import { Card } from '@/components/ui/card'
import type {
  CurriculumChapterSummary,
  CurriculumLessonProgress,
  CurriculumPathProgress,
} from '@/lib/curriculum/contracts'
import type { CurriculumOverviewData, CurriculumOverviewPath } from '@/lib/curriculum/overview'
import { curriculumLessonHref, curriculumPathHref } from '@/lib/curriculum/routes'
import { PASSING_SCORE } from '@/lib/curriculum/thresholds'

function currentLesson(progress: CurriculumPathProgress): CurriculumLessonProgress | null {
  const currentId = progress.summary.currentLesson?.id
  return currentId ? (progress.lessons.find(({ lesson }) => lesson.id === currentId) ?? null) : null
}

function chapterState(
  chapter: CurriculumChapterSummary,
  currentChapterId: string | null,
): 'Complete' | 'Current' | 'Available' | 'Locked' {
  if (chapter.chapterComplete) return 'Complete'
  if (!chapter.chapterUnlocked) return 'Locked'
  return chapter.chapter.id === currentChapterId ? 'Current' : 'Available'
}

function ChapterProgress({
  chapter,
  currentChapterId,
}: {
  chapter: CurriculumChapterSummary
  currentChapterId: string | null
}) {
  const state = chapterState(chapter, currentChapterId)
  return (
    <li className="border-border flex min-w-0 flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-foreground font-medium break-words">{chapter.chapter.title}</span>
        <span className="bg-surface-sunken text-muted rounded-full px-3 py-1 text-xs font-medium">
          {state}
        </span>
      </div>
      <div className="text-muted flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className="numeric">
          {chapter.passedLessons} / {chapter.totalLessons} passed
        </span>
        <span className="numeric">
          {chapter.earnedStars} / {chapter.maximumStars} stars
        </span>
        <span className="numeric">{chapter.masteredLessons} mastered</span>
      </div>
    </li>
  )
}

function SelectedPathProgress({ item }: { item: CurriculumOverviewPath }) {
  const { progress } = item
  const lesson = currentLesson(progress)
  const action = progress.summary.nextAction
  const currentChapterId = progress.summary.currentChapter?.id ?? null
  const pathLabel = item.selection === 'primary' ? 'Primary path' : 'Selected path'

  return (
    <Card className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted text-xs font-medium">{pathLabel}</p>
          <h3 className="text-foreground text-lg font-semibold break-words">
            {progress.path.title}
          </h3>
        </div>
        {progress.summary.pathComplete ? (
          <span className="bg-surface-sunken text-positive rounded-full px-3 py-1 text-xs font-medium">
            Complete
          </span>
        ) : null}
      </div>

      <div className="grid min-w-0 grid-cols-3 gap-3">
        <div className="min-w-0">
          <p className="numeric text-foreground font-medium">
            {progress.summary.passedLessons} / {progress.summary.totalLessons}
          </p>
          <p className="text-muted text-xs">Passed</p>
        </div>
        <div className="min-w-0">
          <p className="numeric text-foreground font-medium">
            {progress.summary.earnedStars} / {progress.summary.maximumStars}
          </p>
          <p className="text-muted text-xs">Stars</p>
        </div>
        <div className="min-w-0">
          <p className="numeric text-foreground font-medium">
            {progress.summary.masteredLessons} / {progress.summary.totalLessons}
          </p>
          <p className="text-muted text-xs">Mastered</p>
        </div>
      </div>

      {lesson && action.kind !== 'complete' ? (
        <div className="bg-surface-sunken rounded-card flex min-w-0 flex-col gap-2 p-4">
          <p className="text-muted text-xs font-medium">
            {lesson.checkpoint ? 'Current checkpoint' : 'Current lesson'}
          </p>
          <Link
            href={curriculumLessonHref(progress.path.slug, lesson.lesson.slug)}
            className="text-accent min-h-11 py-2 font-medium break-words"
          >
            {lesson.lesson.title}
          </Link>
          {action.kind === 'retry' && lesson.bestScore !== null ? (
            <p className="numeric text-muted text-sm">
              Best {lesson.bestScore} · Need {action.requiredScore}
            </p>
          ) : lesson.attemptStatus === 'neutral' ? (
            <p className="text-muted text-sm">You have activity here, but no score.</p>
          ) : (
            <p className="text-muted text-sm">Pass with {PASSING_SCORE} to continue.</p>
          )}
        </div>
      ) : (
        <p className="text-positive text-sm font-medium">All lessons are passed.</p>
      )}

      <ol aria-label={`${progress.path.title} chapter progress`} className="flex flex-col gap-3">
        {progress.chapters.map((chapter) => (
          <ChapterProgress
            key={chapter.chapter.id}
            chapter={chapter}
            currentChapterId={currentChapterId}
          />
        ))}
      </ol>

      <Link
        href={curriculumPathHref(progress.path.slug)}
        className="text-accent min-h-11 self-start py-3 text-sm font-medium"
      >
        View path
      </Link>
    </Card>
  )
}

function AvailablePathProgress({ item }: { item: CurriculumOverviewPath }) {
  const { progress } = item
  return (
    <Link
      href={curriculumPathHref(progress.path.slug)}
      className="bg-surface-sunken hover:bg-accent-soft rounded-card flex min-h-11 min-w-0 flex-col gap-3 p-4"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-foreground font-medium break-words">{progress.path.title}</h3>
        <span className="text-muted text-xs">Not selected</span>
      </div>
      <div className="text-muted flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className="numeric">
          {progress.summary.passedLessons} / {progress.summary.totalLessons} passed
        </span>
        <span className="numeric">
          {progress.summary.earnedStars} / {progress.summary.maximumStars} stars
        </span>
        <span className="numeric">{progress.summary.masteredLessons} mastered</span>
      </div>
    </Link>
  )
}

export function CurriculumProgress({ overview }: { overview: CurriculumOverviewData }) {
  const selected = overview.paths.filter(({ selection }) => selection !== 'available')
  const available = overview.paths.filter(({ selection }) => selection === 'available')

  return (
    <section aria-labelledby="curriculum-progress-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="curriculum-progress-heading" className="text-foreground text-xl font-semibold">
          Path progress
        </h2>
        <p className="text-muted text-sm">Your lesson progress stays with each path.</p>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {selected.map((item) => (
          <SelectedPathProgress key={item.progress.path.id} item={item} />
        ))}
      </div>

      {available.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-foreground font-medium">Other paths</h3>
          {available.map((item) => (
            <AvailablePathProgress key={item.progress.path.id} item={item} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
