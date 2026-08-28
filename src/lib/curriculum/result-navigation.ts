import type { Route } from 'next'
import type { CurriculumLessonLink } from '@/lib/curriculum/contracts'
import {
  curriculumLessonHref,
  curriculumLessonRecordHref,
  curriculumPathHref,
} from '@/lib/curriculum/routes'

export const STRUCTURED_RESULT_STATES = ['not_passed', 'passed', 'neutral'] as const
export type StructuredResultState = (typeof STRUCTURED_RESULT_STATES)[number]

export interface StructuredResultNavigationInput {
  state: StructuredResultState
  attemptId: string
  lesson: CurriculumLessonLink
  nextLesson: CurriculumLessonLink | null
}

export interface StructuredResultRetryAction {
  kind: 'retry'
  href: Route
  lesson: CurriculumLessonLink
  retryOfAttemptId: string
}

export type StructuredResultProgressionAction =
  | {
      kind: 'continue'
      href: Route
      lesson: CurriculumLessonLink
    }
  | {
      kind: 'view_path'
      href: Route
      pathSlug: CurriculumLessonLink['pathSlug']
    }

export interface StructuredResultNavigation {
  retry: StructuredResultRetryAction
  progression: StructuredResultProgressionAction | null
}

/**
 * Builds result-page destinations from server-loaded curriculum links. A retry
 * always stays attached to the current lesson and attempt. Only a passed result
 * can expose progression, including the final path destination.
 */
export function buildStructuredResultNavigation({
  state,
  attemptId,
  lesson,
  nextLesson,
}: StructuredResultNavigationInput): StructuredResultNavigation {
  const retry: StructuredResultRetryAction = {
    kind: 'retry',
    href: curriculumLessonRecordHref(lesson.pathSlug, lesson.slug, attemptId),
    lesson,
    retryOfAttemptId: attemptId,
  }

  if (state !== 'passed') return { retry, progression: null }

  if (nextLesson) {
    return {
      retry,
      progression: {
        kind: 'continue',
        href: curriculumLessonHref(nextLesson.pathSlug, nextLesson.slug),
        lesson: nextLesson,
      },
    }
  }

  return {
    retry,
    progression: {
      kind: 'view_path',
      href: curriculumPathHref(lesson.pathSlug),
      pathSlug: lesson.pathSlug,
    },
  }
}
