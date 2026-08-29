import type { Route } from 'next'
import type {
  CurriculumChapterSummary,
  CurriculumLessonProgress,
  CurriculumPathProgress,
} from '@/lib/curriculum/contracts'
import type { CurriculumOverviewData, CurriculumOverviewPath } from '@/lib/curriculum/overview'
import { curriculumLessonHref, curriculumPathHref } from '@/lib/curriculum/routes'

export interface HomePathAction {
  label: 'Continue' | 'Try Again' | 'View Path'
  href: Route
}

export interface HomePrimaryPath {
  pathTitle: string
  heading: string
  pathComplete: boolean
  transitionLabel: string | null
  chapterLabel: string | null
  lessonTitle: string | null
  lessonStatus: string | null
  action: HomePathAction
  passedLessons: number
  totalLessons: number
  earnedStars: number
  maximumStars: number
}

export interface HomeSecondaryPath {
  id: string
  title: string
  status: string
  href: Route
}

export interface HomeCurriculumModel {
  primary: HomePrimaryPath
  secondary: readonly HomeSecondaryPath[]
}

function levelLabel(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function findCurrentLesson(progress: CurriculumPathProgress): CurriculumLessonProgress | null {
  const lessonId = progress.summary.currentLesson?.id
  return lessonId
    ? (progress.lessons.find((lesson) => lesson.lesson.id === lessonId) ?? null)
    : null
}

function findCurrentChapter(
  progress: CurriculumPathProgress,
  lesson: CurriculumLessonProgress | null,
): CurriculumChapterSummary | null {
  return lesson
    ? (progress.chapters.find((chapter) => chapter.chapter.id === lesson.lesson.chapterId) ?? null)
    : null
}

function transitionLabel(
  progress: CurriculumPathProgress,
  chapter: CurriculumChapterSummary | null,
  lesson: CurriculumLessonProgress | null,
): string | null {
  if (!chapter || !lesson || chapter.chapter.position <= 1 || lesson.lesson.position !== 1) {
    return null
  }
  if (lesson.attempted) return null
  const previous = progress.chapters[chapter.chapter.position - 2]
  return previous?.chapterComplete ? `${levelLabel(previous.chapter.level)} complete` : null
}

function lessonStatus(lesson: CurriculumLessonProgress | null): string | null {
  if (!lesson) return null
  if (lesson.state === 'retry_required' && lesson.bestScore !== null) {
    return `Best: ${lesson.bestScore} · Need 70 to continue`
  }
  return lesson.attemptStatus === 'neutral' ? 'No score yet' : 'Not attempted'
}

function primaryAction(progress: CurriculumPathProgress): HomePathAction {
  const action = progress.summary.nextAction
  if (action.kind === 'complete') {
    return { label: 'View Path', href: curriculumPathHref(progress.path.slug) }
  }
  return {
    label: action.kind === 'retry' ? 'Try Again' : 'Continue',
    href: curriculumLessonHref(progress.path.slug, action.lesson.slug),
  }
}

function buildPrimary(item: CurriculumOverviewPath): HomePrimaryPath {
  const { progress } = item
  const lesson = findCurrentLesson(progress)
  const chapter = findCurrentChapter(progress, lesson)
  const transition = transitionLabel(progress, chapter, lesson)
  return {
    pathTitle: progress.path.title,
    heading:
      progress.summary.pathComplete || transition !== null
        ? progress.path.title
        : `Continue ${progress.path.title}`,
    pathComplete: progress.summary.pathComplete,
    transitionLabel: transition,
    chapterLabel:
      chapter && lesson
        ? `${levelLabel(chapter.chapter.level)} · Lesson ${lesson.lesson.position} of ${chapter.totalLessons}`
        : null,
    lessonTitle: lesson?.lesson.title ?? null,
    lessonStatus: lessonStatus(lesson),
    action: primaryAction(progress),
    passedLessons: progress.summary.passedLessons,
    totalLessons: progress.summary.totalLessons,
    earnedStars: progress.summary.earnedStars,
    maximumStars: progress.summary.maximumStars,
  }
}

function buildSecondary(item: CurriculumOverviewPath): HomeSecondaryPath {
  const { progress } = item
  if (progress.summary.pathComplete) {
    return {
      id: progress.path.id,
      title: progress.path.title,
      status: 'Path complete',
      href: curriculumPathHref(progress.path.slug),
    }
  }
  const lesson = findCurrentLesson(progress)
  const chapter = findCurrentChapter(progress, lesson)
  return {
    id: progress.path.id,
    title: progress.path.title,
    status: chapter
      ? `${levelLabel(chapter.chapter.level)} · ${chapter.passedLessons} / ${chapter.totalLessons} passed`
      : `${progress.summary.passedLessons} / ${progress.summary.totalLessons} passed`,
    href: curriculumPathHref(progress.path.slug),
  }
}

/** Adapts the shared progression engine for Home without recalculating achievement. */
export function buildHomeCurriculumModel(
  overview: CurriculumOverviewData,
): HomeCurriculumModel | null {
  const primary = overview.paths.find((item) => item.selection === 'primary')
  if (!primary) return null
  const secondary = overview.paths
    .filter((item) => item.selection === 'selected')
    .sort((left, right) => (left.preferenceRank ?? 0) - (right.preferenceRank ?? 0))
    .map(buildSecondary)
  return { primary: buildPrimary(primary), secondary }
}
