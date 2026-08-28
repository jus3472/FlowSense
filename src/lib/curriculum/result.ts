import type { Route } from 'next'
import type {
  ChapterLevel,
  CurriculumLessonProgress,
  CurriculumPathProgress,
  PathSlug,
  Stars,
} from '@/lib/curriculum/contracts'
import {
  curriculumLessonHref,
  curriculumLessonRecordHref,
  curriculumPathHref,
} from '@/lib/curriculum/routes'
import { isPassingScore, parseCurriculumScore, starsForScore } from '@/lib/curriculum/thresholds'

export type StructuredLessonResultState = 'not_passed' | 'passed' | 'neutral'

export interface StructuredLessonResultAction {
  label: string
  href: Route
}

export interface StructuredLessonResultModel {
  attemptId: string
  state: StructuredLessonResultState
  currentScore: number | null
  currentStars: Stars
  bestScore: number | null
  bestStars: Stars
  bestAttemptId: string | null
  personalBest: boolean
  path: {
    slug: PathSlug
    title: string
  }
  chapter: {
    level: ChapterLevel
    title: string
  }
  lesson: {
    id: string
    slug: string
    title: string
    position: number
    checkpoint: boolean
  }
  nextLesson: {
    level: ChapterLevel
    position: number
  } | null
  pathComplete: boolean
  primaryAction: StructuredLessonResultAction
  secondaryAction: StructuredLessonResultAction | null
}

function resultState(score: number | null): StructuredLessonResultState {
  if (score === null) return 'neutral'
  return isPassingScore(score) ? 'passed' : 'not_passed'
}

/** Mirrors the database progress trigger's scalar-to-snapshot total check. */
export function validatedStructuredResultScore(
  scalarScore: unknown,
  snapshotScore: unknown,
): number | null {
  const scalar = parseCurriculumScore(scalarScore)
  const snapshot = parseCurriculumScore(snapshotScore)
  return scalar !== null && scalar === snapshot ? scalar : null
}

function retryAction(
  pathSlug: PathSlug,
  lessonSlug: string,
  attemptId: string,
  label = 'Try Again',
): StructuredLessonResultAction {
  return {
    label,
    href: curriculumLessonRecordHref(pathSlug, lessonSlug, attemptId),
  }
}

function passedActions(
  path: CurriculumPathProgress,
  lesson: CurriculumLessonProgress,
  attemptId: string,
): Pick<StructuredLessonResultModel, 'primaryAction' | 'secondaryAction'> {
  const practiceAgain = retryAction(
    path.path.slug,
    lesson.lesson.slug,
    attemptId,
    lesson.stars < 3 ? 'Retry for 3 stars' : 'Practice Again',
  )
  if (lesson.nextLesson) {
    return {
      primaryAction: {
        label: 'Continue',
        href: curriculumLessonHref(path.path.slug, lesson.nextLesson.slug),
      },
      secondaryAction: practiceAgain,
    }
  }
  return {
    primaryAction: {
      label: 'View Path',
      href: curriculumPathHref(path.path.slug),
    },
    secondaryAction: practiceAgain,
  }
}

/**
 * Combines one immutable result snapshot with authoritative path progress.
 * The snapshot classifies this attempt. Durable bests and unlocks come only
 * from lesson_progress as represented by the supplied path topology.
 */
export function buildStructuredLessonResult(input: {
  path: CurriculumPathProgress
  lessonId: string
  attemptId: string
  /** Stored attempts.score scalar. */
  currentScore: unknown
  /** Stored supported snapshot total. */
  snapshotScore: unknown
}): StructuredLessonResultModel | null {
  const lesson = input.path.lessons.find((candidate) => candidate.lesson.id === input.lessonId)
  if (!lesson) return null
  const chapter = input.path.chapters.find(
    (candidate) => candidate.chapter.id === lesson.lesson.chapterId,
  )
  if (!chapter) return null

  const currentScore = validatedStructuredResultScore(input.currentScore, input.snapshotScore)
  const state = resultState(currentScore)
  const actions =
    state === 'passed'
      ? passedActions(input.path, lesson, input.attemptId)
      : {
          primaryAction: retryAction(input.path.path.slug, lesson.lesson.slug, input.attemptId),
          secondaryAction: null,
        }

  return {
    attemptId: input.attemptId,
    state,
    currentScore,
    currentStars: starsForScore(currentScore),
    bestScore: lesson.bestScore,
    bestStars: lesson.stars,
    bestAttemptId: lesson.bestAttemptId,
    personalBest: currentScore !== null && lesson.bestAttemptId === input.attemptId,
    path: {
      slug: input.path.path.slug,
      title: input.path.path.title,
    },
    chapter: {
      level: chapter.chapter.level,
      title: chapter.chapter.title,
    },
    lesson: {
      id: lesson.lesson.id,
      slug: lesson.lesson.slug,
      title: lesson.lesson.title,
      position: lesson.lesson.position,
      checkpoint: lesson.lesson.checkpoint,
    },
    nextLesson: lesson.nextLesson
      ? {
          level: lesson.nextLesson.level,
          position: lesson.nextLesson.position,
        }
      : null,
    pathComplete: lesson.nextLesson === null && input.path.summary.pathComplete,
    ...actions,
  }
}
