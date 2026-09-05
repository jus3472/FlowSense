// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurriculumLessonAccessOutcome } from '@/lib/curriculum/server'

const mocks = vi.hoisted(() => ({
  lessonAccess: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('@/lib/curriculum/server', () => ({
  loadAuthenticatedCurriculumLessonAccess: mocks.lessonAccess,
}))

import CurriculumLessonPage from '@/app/(app)/practice/paths/[pathSlug]/lessons/[lessonSlug]/page'

type AllowedOutcome = Extract<CurriculumLessonAccessOutcome, { status: 'allowed' }>
type AllowedLesson = AllowedOutcome['data']['lesson']

const PATH_SLUG = 'interviews'
const LESSON_SLUG = 'interviews-beginner-04-give-example'
const BEST_ATTEMPT_ID = '40000000-0000-4000-8000-000000000004'
const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

function redirectError(href: string) {
  return new Error(`NEXT_REDIRECT;${href}`)
}

function allowedOutcome(lessonOverrides: Partial<AllowedLesson> = {}): AllowedOutcome {
  return {
    status: 'allowed',
    data: {
      session: {
        lessonId: '10000000-0000-4000-8000-000000000004',
        pathSlug: PATH_SLUG,
        chapterLevel: 'beginner',
        lessonSlug: LESSON_SLUG,
        lessonPosition: 4,
        checkpoint: false,
        promptId: '20000000-0000-4000-8000-000000000004',
        promptText: 'Tell me about a time you solved a small problem.',
        mode: 'interview',
        difficulty: 'beginner',
        targetDurationSeconds: 60,
      },
      lesson: {
        lesson: {
          id: '10000000-0000-4000-8000-000000000004',
          chapterId: '30000000-0000-4000-8000-000000000001',
          slug: LESSON_SLUG,
          title: 'Give a simple example',
          skillFocus: 'Practice supporting an answer with one specific example.',
          position: 4,
          checkpoint: false,
          promptId: '20000000-0000-4000-8000-000000000004',
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
        ...lessonOverrides,
      },
    },
  }
}

async function pageFor(outcome: CurriculumLessonAccessOutcome) {
  mocks.lessonAccess.mockResolvedValueOnce(outcome)
  return CurriculumLessonPage({
    params: Promise.resolve({ pathSlug: PATH_SLUG, lessonSlug: LESSON_SLUG }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.notFound.mockImplementation(() => {
    throw NOT_FOUND
  })
  mocks.redirect.mockImplementation((href: string) => {
    throw redirectError(href)
  })
})

describe('lesson URL compatibility navigation', () => {
  it('redirects an uncompleted lesson directly to its recording flow', async () => {
    await expect(pageFor(allowedOutcome())).rejects.toThrow(
      `NEXT_REDIRECT;/practice/paths/${PATH_SLUG}/lessons/${LESSON_SLUG}/record`,
    )

    expect(mocks.lessonAccess).toHaveBeenCalledExactlyOnceWith(PATH_SLUG, LESSON_SLUG)
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      `/practice/paths/${PATH_SLUG}/lessons/${LESSON_SLUG}/record`,
    )
  })

  it('redirects provider-neutral activity to a fresh recording without inventing a best', async () => {
    await expect(
      pageFor(allowedOutcome({ attempted: true, attemptStatus: 'neutral' })),
    ).rejects.toThrow(/\/record$/)

    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      `/practice/paths/${PATH_SLUG}/lessons/${LESSON_SLUG}/record`,
    )
  })

  it.each([
    { state: 'retry_required', score: 64, passed: false },
    { state: 'passed', score: 88, passed: true },
  ] as const)('redirects a $state lesson to its authoritative best result', async (testCase) => {
    await expect(
      pageFor(
        allowedOutcome({
          state: testCase.state,
          bestScore: testCase.score,
          bestAttemptId: BEST_ATTEMPT_ID,
          attempted: true,
          attemptStatus: 'scored',
          passed: testCase.passed,
        }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT;/attempts/${BEST_ATTEMPT_ID}`)

    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(`/attempts/${BEST_ATTEMPT_ID}`)
  })

  it('uses the recording flow when a deleted best result leaves only durable score progress', async () => {
    await expect(
      pageFor(
        allowedOutcome({
          state: 'passed',
          bestScore: 88,
          bestAttemptId: null,
          attempted: true,
          attemptStatus: 'scored',
          passed: true,
        }),
      ),
    ).rejects.toThrow(/\/record$/)
  })
})

describe('curriculum lesson access outcomes', () => {
  it('renders a locked direct URL without a usable lesson action', async () => {
    const page = await pageFor({ status: 'denied', reason: 'locked' })
    render(page)

    expect(screen.getByRole('heading', { name: 'Lesson locked' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it.each([
    ['path_mismatch', 'This lesson does not belong to this path.'],
    ['inactive', 'This lesson is not available.'],
  ] as const)('keeps a %s lesson unavailable without an action', async (reason, message) => {
    const page = await pageFor({ status: 'denied', reason })
    render(page)

    expect(screen.getByRole('heading', { name: 'Lesson unavailable' })).toBeInTheDocument()
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it.each([
    { status: 'not_found', resource: 'path' },
    { status: 'not_found', resource: 'lesson' },
  ] as const)('uses the not-found boundary for a missing $resource', async (outcome) => {
    await expect(pageFor(outcome)).rejects.toBe(NOT_FOUND)
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('renders a retryable server query failure that does not look locked', async () => {
    const page = await pageFor({ status: 'failure', reason: 'query', operation: 'prompt' })
    render(page)

    expect(screen.getByRole('heading', { name: 'Lesson did not load' })).toBeInTheDocument()
    expect(screen.queryByText(/locked/i)).not.toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Try again' })
    fireEvent.click(retry)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('redirects an unauthenticated request to login', async () => {
    await expect(pageFor({ status: 'unauthenticated' })).rejects.toThrow('NEXT_REDIRECT;/login')
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith('/login')
  })
})

describe('lesson page boundary', () => {
  it('keeps authorization in the route and removes the standalone lesson-detail screen', () => {
    const pageSource = readFileSync(
      'src/app/(app)/practice/paths/[pathSlug]/lessons/[lessonSlug]/page.tsx',
      'utf8',
    )
    const statesSource = readFileSync('src/components/curriculum/lesson-detail.tsx', 'utf8')

    expect(pageSource).toContain('loadAuthenticatedCurriculumLessonAccess(pathSlug, lessonSlug)')
    expect(pageSource).toContain('attemptResultHref(lesson.bestAttemptId)')
    expect(pageSource).toContain('curriculumLessonRecordHref(session.pathSlug, session.lessonSlug)')
    expect(pageSource).not.toContain('createClient')
    expect(pageSource).not.toContain('CurriculumLessonDetail')
    expect(statesSource).not.toContain('Your prompt')
    expect(statesSource).not.toContain('Lesson state')
  })
})
