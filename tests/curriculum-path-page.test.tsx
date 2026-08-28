// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CurriculumPathDefinition,
  CurriculumPathProgress,
  PersistedLessonProgress,
} from '@/lib/curriculum/contracts'
import { buildCurriculumPathProgress } from '@/lib/curriculum/progression'

const mocks = vi.hoisted(() => ({
  loadAuthenticatedCurriculumPath: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/lib/curriculum/server', () => ({
  loadAuthenticatedCurriculumPath: mocks.loadAuthenticatedCurriculumPath,
}))
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import CurriculumPathPage from '@/app/(app)/practice/paths/[pathSlug]/page'
import { CurriculumPathLadder } from '@/components/curriculum/path-ladder'

const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')
const REDIRECT = new Error('NEXT_REDIRECT;/login')
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const
const LEVEL_TITLES = ['Beginner', 'Intermediate', 'Advanced'] as const

interface PathOptions {
  active?: boolean
  inactiveChapter?: number
  inactiveLesson?: number
}

function makePath(options: PathOptions = {}): CurriculumPathDefinition {
  const pathId = 'path-general-speaking'
  return {
    id: pathId,
    slug: 'general-speaking',
    title: 'General Speaking',
    mode: 'practice',
    position: 1,
    active: options.active ?? true,
    chapters: LEVELS.map((level, chapterIndex) => {
      const chapterId = `${pathId}-${level}`
      const title = LEVEL_TITLES[chapterIndex]
      if (!title) throw new Error('Missing test chapter title.')
      return {
        id: chapterId,
        pathId,
        level,
        title,
        position: chapterIndex + 1,
        active: options.inactiveChapter !== chapterIndex,
        lessons: Array.from({ length: 10 }, (_, lessonIndex) => {
          const position = lessonIndex + 1
          const globalIndex = chapterIndex * 10 + lessonIndex
          return {
            id: `lesson-${globalIndex + 1}`,
            chapterId,
            slug: `general-speaking-${level}-${String(position).padStart(2, '0')}-skill-${position}`,
            title: `${title} lesson ${position}`,
            skillFocus: `Practice skill ${position}.`,
            position,
            checkpoint: position === 10,
            promptId: `prompt-${globalIndex + 1}`,
            active: options.inactiveLesson !== globalIndex,
          }
        }),
      }
    }),
  }
}

function buildProgress(
  scores: readonly number[] = [],
  options: PathOptions = {},
  neutralFirstLesson = false,
): CurriculumPathProgress {
  const path = makePath(options)
  const lessons = path.chapters.flatMap((chapter) => chapter.lessons)
  const progress: PersistedLessonProgress[] = scores.map((score, index) => {
    const lesson = lessons[index]
    if (!lesson) throw new Error('Test score is outside the curriculum.')
    return {
      lessonId: lesson.id,
      bestScore: score,
      bestAttemptId: `attempt-${index + 1}`,
    }
  })
  const outcome = buildCurriculumPathProgress({
    path,
    progress,
    attemptEvidence: neutralFirstLesson ? [{ lessonId: 'lesson-1' }] : [],
  })
  if (!outcome.ok) throw new Error(`${outcome.error.kind}: ${outcome.error.code}`)
  return outcome.value
}

function renderLadder(progress = buildProgress()) {
  return render(<CurriculumPathLadder progress={progress} />)
}

async function renderPage(pathSlug = 'general-speaking') {
  render(await CurriculumPathPage({ params: Promise.resolve({ pathSlug }) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.notFound.mockImplementation(() => {
    throw NOT_FOUND
  })
  mocks.redirect.mockImplementation(() => {
    throw REDIRECT
  })
})

describe('curriculum path ladder', () => {
  it('renders a fresh path with exact totals and locked future lesson titles', () => {
    renderLadder()

    expect(screen.getByRole('heading', { level: 1, name: 'General Speaking' })).toBeInTheDocument()
    expect(screen.getByText('0 / 30 passed')).toBeInTheDocument()
    expect(screen.getByText('0 / 90 stars')).toBeInTheDocument()
    const currentChapter = screen.getByText('Current chapter').parentElement
    if (!currentChapter) throw new Error('Missing current chapter summary.')
    expect(within(currentChapter).getByText('0 / 10 passed')).toBeInTheDocument()

    const current = screen.getByRole('link', { name: /Beginner lesson 1/ })
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(within(current).getByText('Current lesson')).toBeInTheDocument()
    expect(within(current).getByText('Not attempted')).toBeInTheDocument()
    expect(within(current).getByText('Start')).toBeInTheDocument()

    const lockedLesson = screen.getByRole('heading', { name: 'Intermediate lesson 1' })
    expect(lockedLesson.closest('a')).toBeNull()
    expect(lockedLesson.closest('[aria-disabled="true"]')).toHaveTextContent(
      'Pass the previous lesson to unlock this one.',
    )
    expect(screen.getAllByText('Chapter locked')).toHaveLength(2)
    expect(
      screen.getByText('Pass the Beginner checkpoint to unlock this chapter.'),
    ).toBeInTheDocument()
  })

  it('marks a retry as current while preserving one-star and two-star passes', () => {
    renderLadder(buildProgress([74, 86, 64]))

    expect(screen.getByText('2 / 30 passed')).toBeInTheDocument()
    expect(screen.getByText('3 / 90 stars')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '1 of 3 stars' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2 of 3 stars' })).toBeInTheDocument()

    const retry = screen.getByRole('link', { name: /Beginner lesson 3/ })
    expect(retry).toHaveAttribute('aria-current', 'step')
    expect(within(retry).getByRole('img', { name: '0 of 3 stars' })).toBeInTheDocument()
    expect(within(retry).getByText('Best 64')).toBeInTheDocument()
    expect(within(retry).getByText('Need 70')).toBeInTheDocument()
    expect(within(retry).getByText('Try Again')).toBeInTheDocument()
  })

  it('keeps neutral speaking activity available without calling it unattempted', () => {
    renderLadder(buildProgress([], {}, true))

    const current = screen.getByRole('link', { name: /Beginner lesson 1/ })
    expect(within(current).getByText('No score yet')).toBeInTheDocument()
    expect(within(current).getByText('Start')).toBeInTheDocument()
    expect(within(current).queryByText('Not attempted')).not.toBeInTheDocument()
  })

  it('shows checkpoints and unlocks Intermediate after the Beginner checkpoint passes', () => {
    renderLadder(buildProgress(Array.from({ length: 10 }, () => 90)))

    expect(screen.getByText('10 / 30 passed')).toBeInTheDocument()
    expect(screen.getByText('30 / 90 stars')).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: '3 of 3 stars' })).toHaveLength(10)
    expect(screen.getAllByText('Checkpoint')).toHaveLength(3)
    expect(
      screen.getByText('This checkpoint unlocks Intermediate when you pass with 70.'),
    ).toBeInTheDocument()

    const intermediate = screen.getByRole('link', { name: /Intermediate lesson 1/ })
    expect(intermediate).toHaveAttribute('aria-current', 'step')
    expect(within(intermediate).getByText('Start')).toBeInTheDocument()
    expect(
      screen.queryByText('Pass the Beginner checkpoint to unlock this chapter.'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Pass the Intermediate checkpoint to unlock this chapter.'),
    ).toBeInTheDocument()
  })

  it('unlocks Advanced after the Intermediate checkpoint passes', () => {
    renderLadder(buildProgress(Array.from({ length: 20 }, () => 80)))

    expect(screen.getByText('20 / 30 passed')).toBeInTheDocument()
    expect(screen.getByText('40 / 90 stars')).toBeInTheDocument()
    const advanced = screen.getByRole('link', { name: /Advanced lesson 1/ })
    expect(advanced).toHaveAttribute('aria-current', 'step')
    expect(within(advanced).getByText('Start')).toBeInTheDocument()
    expect(
      screen.queryByText('Pass the Intermediate checkpoint to unlock this chapter.'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('This checkpoint completes the path when you pass with 70.'),
    ).toBeInTheDocument()
  })

  it('renders an exact completed path without a current lesson', () => {
    renderLadder(buildProgress(Array.from({ length: 30 }, () => 86)))

    expect(screen.getByText('Path complete')).toBeInTheDocument()
    expect(screen.getByText('30 / 30 passed')).toBeInTheDocument()
    expect(screen.getByText('60 / 90 stars')).toBeInTheDocument()
    expect(screen.queryByRole('link', { current: 'step' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /View lesson/ })).toHaveLength(30)
  })

  it('keeps the ladder narrow-screen stable with wrapping and no fixed content width', () => {
    const source = readFileSync('src/components/curriculum/path-ladder.tsx', 'utf8')
    const { container } = renderLadder()

    expect(container.firstElementChild).toHaveClass('min-w-0')
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveClass('break-words')
    expect(source).toContain('flex-wrap')
    expect(source).not.toMatch(/\bw-\[(?:\d+px|\d+rem)\]/)
    expect(source).not.toContain('whitespace-nowrap')
  })
})

describe('curriculum path route outcomes', () => {
  it('awaits the route slug and renders the authenticated path', async () => {
    mocks.loadAuthenticatedCurriculumPath.mockResolvedValue({
      status: 'ready',
      data: buildProgress(),
    })

    await renderPage('general-speaking')

    expect(mocks.loadAuthenticatedCurriculumPath).toHaveBeenCalledExactlyOnceWith(
      'general-speaking',
    )
    expect(screen.getByRole('heading', { level: 1, name: 'General Speaking' })).toBeInTheDocument()
  })

  it('redirects unauthenticated users to login', async () => {
    mocks.loadAuthenticatedCurriculumPath.mockResolvedValue({ status: 'unauthenticated' })

    await expect(
      CurriculumPathPage({ params: Promise.resolve({ pathSlug: 'interviews' }) }),
    ).rejects.toBe(REDIRECT)
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith('/login')
  })

  it.each(['missing-path', 'not-a-path'])(
    'uses notFound for a missing or invalid %s slug',
    async (pathSlug) => {
      mocks.loadAuthenticatedCurriculumPath.mockResolvedValue({
        status: 'not_found',
        resource: 'path',
      })

      await expect(CurriculumPathPage({ params: Promise.resolve({ pathSlug }) })).rejects.toBe(
        NOT_FOUND,
      )
      expect(mocks.notFound).toHaveBeenCalledOnce()
    },
  )

  it('renders typed failures as recoverable errors instead of locked curriculum', async () => {
    mocks.loadAuthenticatedCurriculumPath.mockResolvedValue({
      status: 'failure',
      reason: 'query',
      operation: 'progress',
    })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'This path did not load' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Chapter locked')).not.toBeInTheDocument()
  })

  it.each([
    ['path', { active: false }],
    ['chapter', { inactiveChapter: 1 }],
    ['lesson', { inactiveLesson: 0 }],
  ] as const)(
    'fails closed when an active topology contains an inactive %s',
    async (_label, options) => {
      mocks.loadAuthenticatedCurriculumPath.mockResolvedValue({
        status: 'ready',
        data: buildProgress([], options),
      })

      await renderPage()

      expect(
        screen.getByRole('heading', { name: 'This path is not available' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'General Speaking' })).not.toBeInTheDocument()
      expect(screen.queryByText('Beginner lesson 1')).not.toBeInTheDocument()
    },
  )
})
