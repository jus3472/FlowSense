import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { RecordFlow } from '@/components/record/record-flow'
import {
  CurriculumLessonDeniedState,
  CurriculumLessonFailureState,
} from '@/components/curriculum/lesson-detail'
import { RetryButton } from '@/components/system/retry-button'
import { ButtonLink } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { reconcileCurrentUserStaleAttempts } from '@/lib/attempts/reconciliation'
import {
  matchesStructuredRetryParent,
  structuredPracticeSession,
} from '@/lib/curriculum/recording'
import { curriculumLessonHref } from '@/lib/curriculum/routes'
import { loadAuthenticatedCurriculumLessonAccess } from '@/lib/curriculum/server'
import { parseRecordRetryParam } from '@/lib/practice/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Record Lesson' }
export const dynamic = 'force-dynamic'

function safeErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'unknown'
  const code = error.code
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code) ? code : 'unknown'
}

function StructuredRetryUnavailable({ href }: { href: ReturnType<typeof curriculumLessonHref> }) {
  return (
    <ErrorState
      title="That lesson retry is not available"
      description="Start a new response from the lesson page."
    >
      <ButtonLink href={href} variant="secondary">
        View lesson
      </ButtonLink>
    </ErrorState>
  )
}

async function loadStructuredRetryParent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  attemptId: string,
): Promise<{ status: 'ready'; data: unknown } | { status: 'failure' }> {
  try {
    const { data, error } = await supabase
      .from('attempts')
      .select(
        'id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source, prompt_difficulty, metrics, status',
      )
      .eq('id', attemptId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('[curriculum] structured retry load failed', {
        operation: 'retry_attempt',
        code: safeErrorCode(error),
      })
      return { status: 'failure' }
    }
    return { status: 'ready', data }
  } catch (error) {
    console.error('[curriculum] structured retry load failed', {
      operation: 'retry_attempt',
      code: safeErrorCode(error),
    })
    return { status: 'failure' }
  }
}

export default async function CurriculumLessonRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ pathSlug: string; lessonSlug: string }>
  searchParams: Promise<{ retry?: string | string[] }>
}) {
  const { pathSlug, lessonSlug } = await params
  const access = await loadAuthenticatedCurriculumLessonAccess(pathSlug, lessonSlug)

  if (access.status === 'unauthenticated') return redirect('/login')
  if (access.status === 'not_found') return notFound()
  if (access.status === 'denied') return <CurriculumLessonDeniedState reason={access.reason} />
  if (access.status === 'failure') return <CurriculumLessonFailureState />

  const lessonHref = curriculumLessonHref(access.data.session.pathSlug, access.data.session.lessonSlug)
  const retryOfAttemptId = parseRecordRetryParam((await searchParams).retry)
  if (retryOfAttemptId === null) return <StructuredRetryUnavailable href={lessonHref} />

  if (retryOfAttemptId !== undefined) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return redirect('/login')

    await reconcileCurrentUserStaleAttempts(user.id, { attemptId: retryOfAttemptId })
    const parent = await loadStructuredRetryParent(supabase, user.id, retryOfAttemptId)
    if (parent.status === 'failure') {
      return (
        <ErrorState
          title="Your lesson retry did not load"
          description="The connection to your response failed. Try loading it again."
        >
          <RetryButton />
        </ErrorState>
      )
    }

    if (!matchesStructuredRetryParent(parent.data, access.data.session, retryOfAttemptId)) {
      return <StructuredRetryUnavailable href={lessonHref} />
    }
  }

  const session = structuredPracticeSession(access.data.session, retryOfAttemptId ?? null)
  if (!session) return <CurriculumLessonFailureState />
  return <RecordFlow session={session} />
}
