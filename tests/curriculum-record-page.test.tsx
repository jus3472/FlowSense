// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurriculumLessonAccessOutcome } from '@/lib/curriculum/server'

const mocks = vi.hoisted(() => ({
  lessonAccess: vi.fn(),
  createClient: vi.fn(),
  reconcile: vi.fn(),
  recordFlow: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({
  default: function MockLink({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/lib/curriculum/server', () => ({
  loadAuthenticatedCurriculumLessonAccess: mocks.lessonAccess,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/attempts/reconciliation', () => ({
  reconcileCurrentUserStaleAttempts: mocks.reconcile,
}))
vi.mock('@/components/record/record-flow', () => ({
  RecordFlow: ({ session }: { session: unknown }) => {
    mocks.recordFlow(session)
    return <div data-testid="record-flow">Recorder</div>
  },
}))

import CurriculumLessonRecordPage from '@/app/(app)/practice/paths/[pathSlug]/lessons/[lessonSlug]/record/page'

type Allowed = Extract<CurriculumLessonAccessOutcome, { status: 'allowed' }>

const USER_ID = '10000000-0000-4000-8000-000000000001'
const LESSON_ID = '20000000-0000-4000-8000-000000000002'
const PROMPT_ID = '30000000-0000-4000-8000-000000000003'
const ATTEMPT_ID = '40000000-0000-4000-8000-000000000004'
const PATH_SLUG = 'interviews'
const LESSON_SLUG = 'interviews-beginner-01-answer-directly'

const ALLOWED: Allowed = {
  status: 'allowed',
  data: {
    session: {
      lessonId: LESSON_ID,
      pathSlug: PATH_SLUG,
      chapterLevel: 'beginner',
      lessonSlug: LESSON_SLUG,
      lessonPosition: 1,
      checkpoint: false,
      promptId: PROMPT_ID,
      promptText: 'Describe a choice you made recently.',
      mode: 'interview',
      difficulty: 'beginner',
      targetDurationSeconds: 60,
    },
    lesson: {
      lesson: {
        id: LESSON_ID,
        chapterId: '50000000-0000-4000-8000-000000000005',
        slug: LESSON_SLUG,
        title: 'Answer directly',
        skillFocus: 'Start with the main point.',
        position: 1,
        checkpoint: false,
        promptId: PROMPT_ID,
        active: true,
      },
      state: 'available',
      bestScore: null,
      bestAttemptId: null,
      stars: 0,
      passed: false,
      attempted: false,
      attemptStatus: 'none',
      checkpoint: false,
      previousLesson: null,
      nextLesson: null,
    },
  },
}

function retryParent(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    prompt_id: PROMPT_ID,
    lesson_id: LESSON_ID,
    prompt_text: ALLOWED.data.session.promptText,
    practice_mode: 'interview',
    prompt_source: 'library',
    prompt_difficulty: 'beginner',
    metrics: { practice: { target_duration_seconds: 60 } },
    status: 'done',
    ...overrides,
  }
}

function useClient(parent: unknown = retryParent()) {
  const operations: Array<[string, ...unknown[]]> = []
  const query = {
    select: vi.fn((...args: unknown[]) => {
      operations.push(['select', ...args])
      return query
    }),
    eq: vi.fn((...args: unknown[]) => {
      operations.push(['eq', ...args])
      return query
    }),
    maybeSingle: vi.fn(async () => ({ data: parent, error: null })),
  }
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    from: vi.fn(() => query),
  })
  return { operations, query }
}

async function renderPage(
  outcome: CurriculumLessonAccessOutcome,
  retry?: string | string[],
) {
  mocks.lessonAccess.mockResolvedValueOnce(outcome)
  const page = await CurriculumLessonRecordPage({
    params: Promise.resolve({ pathSlug: PATH_SLUG, lessonSlug: LESSON_SLUG }),
    searchParams: Promise.resolve({ ...(retry === undefined ? {} : { retry }) }),
  })
  if (page) render(page)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reconcile.mockResolvedValue({ status: 'ready', reconciled: [] })
})

afterEach(() => cleanup())

describe('structured lesson record route', () => {
  it('revalidates access and feeds the existing recorder an authoritative session', async () => {
    await renderPage(ALLOWED)

    expect(mocks.lessonAccess).toHaveBeenCalledExactlyOnceWith(PATH_SLUG, LESSON_SLUG)
    expect(screen.getByTestId('record-flow')).toBeInTheDocument()
    expect(mocks.recordFlow).toHaveBeenCalledWith({
      promptId: PROMPT_ID,
      promptText: ALLOWED.data.session.promptText,
      mode: 'interview',
      difficulty: 'beginner',
      source: 'library',
      targetDurationSeconds: 60,
      retryOfAttemptId: null,
      curriculum: {
        lessonId: LESSON_ID,
        pathSlug: PATH_SLUG,
        chapterLevel: 'beginner',
        lessonSlug: LESSON_SLUG,
        lessonPosition: 1,
        checkpoint: false,
      },
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('inherits a retry only from an owned settled attempt for the same lesson', async () => {
    const setup = useClient()

    await renderPage(ALLOWED, ATTEMPT_ID)

    expect(screen.getByTestId('record-flow')).toBeInTheDocument()
    expect(mocks.recordFlow).toHaveBeenCalledWith(
      expect.objectContaining({ retryOfAttemptId: ATTEMPT_ID }),
    )
    expect(mocks.reconcile).toHaveBeenCalledWith(USER_ID, { attemptId: ATTEMPT_ID })
    expect(setup.operations).toContainEqual(['eq', 'id', ATTEMPT_ID])
    expect(setup.operations).toContainEqual(['eq', 'user_id', USER_ID])
  })

  it.each([
    ['a malformed retry', 'not-a-uuid'],
    ['repeated retry values', [ATTEMPT_ID, ATTEMPT_ID]],
  ])('fails closed for %s before reading an attempt', async (_label, retry) => {
    useClient()

    await renderPage(ALLOWED, retry)

    expect(screen.getByRole('heading', { name: 'That lesson retry is not available' })).toBeInTheDocument()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.recordFlow).not.toHaveBeenCalled()
  })

  it('rejects a retry parent from a different lesson', async () => {
    useClient(retryParent({ lesson_id: '60000000-0000-4000-8000-000000000006' }))

    await renderPage(ALLOWED, ATTEMPT_ID)

    expect(screen.getByRole('heading', { name: 'That lesson retry is not available' })).toBeInTheDocument()
    expect(mocks.recordFlow).not.toHaveBeenCalled()
  })

  it.each([
    ['locked', { status: 'denied', reason: 'locked' } as const, 'Lesson locked'],
    ['inactive', { status: 'denied', reason: 'inactive' } as const, 'Lesson unavailable'],
    [
      'query failure',
      { status: 'failure', reason: 'query', operation: 'lessons' } as const,
      'Lesson did not load',
    ],
  ])('keeps a %s lesson out of the recorder', async (_label, outcome, heading) => {
    await renderPage(outcome)

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(mocks.recordFlow).not.toHaveBeenCalled()
  })
})
