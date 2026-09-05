import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  CurriculumLessonDeniedState,
  CurriculumLessonFailureState,
} from '@/components/curriculum/lesson-detail'
import { attemptResultHref, curriculumLessonRecordHref } from '@/lib/curriculum/routes'
import { loadAuthenticatedCurriculumLessonAccess } from '@/lib/curriculum/server'

export const metadata: Metadata = { title: 'Lesson' }
export const dynamic = 'force-dynamic'

export default async function CurriculumLessonPage({
  params,
}: {
  params: Promise<{ pathSlug: string; lessonSlug: string }>
}) {
  const { pathSlug, lessonSlug } = await params
  const outcome = await loadAuthenticatedCurriculumLessonAccess(pathSlug, lessonSlug)

  if (outcome.status === 'unauthenticated') return redirect('/login')
  if (outcome.status === 'not_found') return notFound()
  if (outcome.status === 'denied') {
    return <CurriculumLessonDeniedState reason={outcome.reason} />
  }
  if (outcome.status === 'failure') return <CurriculumLessonFailureState />

  const { lesson, session } = outcome.data
  if (lesson.bestAttemptId) redirect(attemptResultHref(lesson.bestAttemptId))
  redirect(curriculumLessonRecordHref(session.pathSlug, session.lessonSlug))
}
