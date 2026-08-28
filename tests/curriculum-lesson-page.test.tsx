// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurriculumLessonAccessOutcome } from '@/lib/curriculum/server'

const mocks = vi.hoisted(() => ({
  lessonAccess: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
}))

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

function allowedOutcome(
  lessonOverrides: Partial<AllowedLesson> = {},
  definitionOverrides: Partial<AllowedLesson['lesson']> = {},
): AllowedOutcome {
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
          ...definitionOverrides,
        },
        state: 'available',
        bestScore: null,
        bestAttemptId: null,
        stars: 0,
        passed: false,
        attempted: false,
        attemptStatus: 'none',
        checkpoint: false,
        previousLesson: {
          id: '10000000-0000-4000-8000-000000000003',
          slug: 'interviews-beginner-03-answer-directly',
          pathSlug: 'interviews',
          level: 'beginner',
          position: 3,
        },
        nextLesson: {
          id: '10000000-0000-4000-8000-000000000005',
          slug: 'interviews-beginner-05-explain-choice',
          pathSlug: 'interviews',
          level: 'beginner',
          position: 5,
        },
        ...lessonOverrides,
      },
    },
  }
}

async function renderPage(
  outcome: CurriculumLessonAccessOutcome,
  params = { pathSlug: PATH_SLUG, lessonSlug: LESSON_SLUG },
) {
  mocks.lessonAccess.mockResolvedValueOnce(outcome)
  const page = await CurriculumLessonPage({ params: Promise.resolve(params) })
  if (page) render(page)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('available curriculum lesson page', () => {
  it('renders the focused authoritative pre-recording details for a fresh lesson', async () => {
    await renderPage(allowedOutcome())

    expect(mocks.lessonAccess).toHaveBeenCalledExactlyOnceWith(PATH_SLUG, LESSON_SLUG)
    expect(screen.getByRole('link', { name: 'Interviews' })).toHaveAttribute(
      'href',
      '/practice/paths/interviews',
    )
    expect(screen.getByText('Beginner · Lesson 4 of 10')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Give a simple example' })).toBeInTheDocument()
    expect(
      screen.getByText('Practice supporting an answer with one specific example.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Tell me about a time you solved a small problem.')).toBeInTheDocument()
    expect(screen.getByText('Target: about 1 minute')).toBeInTheDocument()
    expect(screen.getByText('Pass: 70')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()

    const action = screen.getByRole('button', { name: 'Start Lesson' })
    expect(action).toBeDisabled()
    expect(action).toHaveAttribute('aria-describedby', 'curriculum-recording-status')
    expect(screen.getByText('Lesson recording is not available from this page yet.')).toBeVisible()
    expect(document.querySelector('a[href^="/record"]')).not.toBeInTheDocument()
  })

  it('shows provider-neutral activity without fabricating a score or stars', async () => {
    await renderPage(
      allowedOutcome({ attempted: true, attemptStatus: 'neutral', bestScore: null, stars: 0 }),
    )

    expect(screen.getByText('You have activity here, but no score.')).toBeInTheDocument()
    expect(screen.queryByText(/Best:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /stars/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Lesson' })).toBeDisabled()
  })
})

describe('scored curriculum lesson page', () => {
  it('shows retry state, exact best score, accessible stars, and the pass requirement', async () => {
    await renderPage(
      allowedOutcome({
        state: 'retry_required',
        bestScore: 64,
        bestAttemptId: '40000000-0000-4000-8000-000000000004',
        stars: 0,
        attempted: true,
        attemptStatus: 'scored',
      }),
    )

    expect(screen.getByText('Retry required')).toBeInTheDocument()
    expect(screen.getByText('64')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '0 of 3 stars' })).toBeInTheDocument()
    expect(screen.getByText('Need 70 to continue.')).toBeInTheDocument()
    expect(screen.getByText('Pass: 70')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDisabled()
  })

  it('shows a passed lesson with its best score and stars', async () => {
    await renderPage(
      allowedOutcome({
        state: 'passed',
        bestScore: 86,
        bestAttemptId: '40000000-0000-4000-8000-000000000004',
        stars: 2,
        passed: true,
        attempted: true,
        attemptStatus: 'scored',
      }),
    )

    expect(screen.getByText('Passed')).toBeInTheDocument()
    expect(screen.getByText('86')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2 of 3 stars' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Practice Again' })).toBeDisabled()
  })
})

describe('curriculum lesson access outcomes', () => {
  it('renders a locked direct URL without a usable lesson action', async () => {
    await renderPage({ status: 'denied', reason: 'locked' })

    expect(screen.getByRole('heading', { name: 'Lesson locked' })).toBeInTheDocument()
    expect(screen.getByText('Pass the previous lesson to unlock this lesson.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it.each([
    ['path_mismatch', 'This lesson does not belong to this path.'],
    ['inactive', 'This lesson is not available.'],
  ] as const)('keeps a %s lesson unavailable without an action', async (reason, message) => {
    await renderPage({ status: 'denied', reason })

    expect(screen.getByRole('heading', { name: 'Lesson unavailable' })).toBeInTheDocument()
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it.each([
    { status: 'not_found', resource: 'path' },
    { status: 'not_found', resource: 'lesson' },
  ] as const)('uses the not-found boundary for a missing $resource', async (outcome) => {
    await renderPage(outcome)

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
    expect(document.body).toBeEmptyDOMElement()
  })

  it('renders a retryable server query failure that does not look locked', async () => {
    await renderPage({ status: 'failure', reason: 'query', operation: 'prompt' })

    expect(screen.getByRole('heading', { name: 'Lesson did not load' })).toBeInTheDocument()
    expect(screen.queryByText(/locked/i)).not.toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('redirects an unauthenticated request to login', async () => {
    await renderPage({ status: 'unauthenticated' })

    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith('/login')
    expect(document.body).toBeEmptyDOMElement()
  })
})

describe('lesson page boundary and mobile layout', () => {
  it('uses only the authoritative lesson access boundary and no record query handoff', () => {
    const pageSource = readFileSync(
      'src/app/(app)/practice/paths/[pathSlug]/lessons/[lessonSlug]/page.tsx',
      'utf8',
    )
    const detailSource = readFileSync('src/components/curriculum/lesson-detail.tsx', 'utf8')

    expect(pageSource).toContain('const { pathSlug, lessonSlug } = await params')
    expect(pageSource).toContain('loadAuthenticatedCurriculumLessonAccess(pathSlug, lessonSlug)')
    expect(pageSource).not.toContain('createClient')
    expect(detailSource).not.toContain('/record?prompt=')
    expect(detailSource).not.toContain('recordHrefForPrompt')
  })

  it('keeps long lesson and prompt text wrapping inside the narrow column', async () => {
    await renderPage(
      allowedOutcome(
        {},
        {
          title: 'A long lesson title that wraps instead of making the page wider than the screen',
          skillFocus: 'A long skill description that remains readable on a narrow screen.',
        },
      ),
    )

    expect(screen.getByRole('article')).toHaveClass('min-w-0')
    expect(
      screen.getByRole('heading', {
        name: 'A long lesson title that wraps instead of making the page wider than the screen',
      }),
    ).toHaveClass('break-words')
    expect(screen.getByText('Tell me about a time you solved a small problem.')).toHaveClass(
      'break-words',
    )
  })
})
