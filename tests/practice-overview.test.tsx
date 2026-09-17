// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeOverview } from '@/components/curriculum/home-overview'
import {
  PATH_MODES,
  PATH_POSITIONS,
  PATH_SLUGS,
  type CurriculumPathDefinition,
  type CurriculumPathProgress,
  type PathSlug,
  type PersistedLessonProgress,
} from '@/lib/curriculum/contracts'
import {
  buildCurriculumOverview,
  parseCurriculumPreferenceRows,
  type CurriculumOverviewData,
} from '@/lib/curriculum/overview'
import { buildCurriculumPathProgress } from '@/lib/curriculum/progression'
import { loadCurriculumOverviewForUser, type CurriculumPathLoader } from '@/lib/curriculum/server'
import type { Database } from '@/lib/types/database'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const USER_ID = '00000000-0000-5000-8000-000000000900'
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const
const TITLES: Record<PathSlug, string> = {
  'general-speaking': 'General Speaking',
  interviews: 'Interviews',
  presentations: 'Presentations',
  conversations: 'Conversations',
}

function definition(slug: PathSlug): CurriculumPathDefinition {
  const pathId = `${slug}-path`
  return {
    id: pathId,
    slug,
    title: TITLES[slug],
    mode: PATH_MODES[slug],
    position: PATH_POSITIONS[slug],
    active: true,
    chapters: LEVELS.map((level, chapterIndex) => {
      const chapterId = `${slug}-${level}-chapter`
      return {
        id: chapterId,
        pathId,
        level,
        title: `${TITLES[slug]} ${level}`,
        position: chapterIndex + 1,
        active: true,
        lessons: Array.from({ length: 10 }, (_, lessonIndex) => {
          const position = lessonIndex + 1
          const sequence = chapterIndex * 10 + position
          return {
            id: `${slug}-lesson-${sequence}`,
            chapterId,
            slug: `${slug}-${level}-${String(position).padStart(2, '0')}-skill-${sequence}`,
            title: `${TITLES[slug]} lesson ${sequence}`,
            skillFocus: `Skill ${sequence}`,
            position,
            checkpoint: position === 10,
            promptId: `${slug}-prompt-${sequence}`,
            active: true,
          }
        }),
      }
    }),
  }
}

function progress(
  slug: PathSlug,
  options: { passed?: number; retryScore?: number; neutral?: boolean } = {},
): CurriculumPathProgress {
  const path = definition(slug)
  const lessons = path.chapters.flatMap((chapter) => chapter.lessons)
  const stored: PersistedLessonProgress[] = lessons
    .slice(0, options.passed ?? 0)
    .map((lesson) => ({ lessonId: lesson.id, bestScore: 90, bestAttemptId: null }))
  if (options.retryScore !== undefined) {
    const current = lessons[options.passed ?? 0]
    if (!current) throw new Error('Test progress has no current lesson.')
    stored.push({
      lessonId: current.id,
      bestScore: options.retryScore,
      bestAttemptId: `attempt-${slug}-${(options.passed ?? 0) + 1}`,
    })
  }
  const neutralLesson = options.neutral ? lessons[options.passed ?? 0] : undefined
  if (options.neutral && !neutralLesson) throw new Error('Test progress has no neutral lesson.')
  const built = buildCurriculumPathProgress({
    path,
    progress: stored,
    attemptEvidence: neutralLesson ? [{ lessonId: neutralLesson.id }] : [],
  })
  if (!built.ok) throw new Error(`Invalid test fixture: ${built.error.code}`)
  return built.value
}

function emptyProgress(path: CurriculumPathDefinition): CurriculumPathProgress {
  const built = buildCurriculumPathProgress({ path, progress: [] })
  if (!built.ok) throw new Error(`Invalid empty progress fixture: ${built.error.code}`)
  return built.value
}

function allPaths(): CurriculumPathProgress[] {
  return [
    progress('general-speaking'),
    progress('interviews', { retryScore: 64 }),
    progress('presentations', { passed: 30 }),
    progress('conversations', { passed: 2 }),
  ]
}

function overview(): CurriculumOverviewData {
  const built = buildCurriculumOverview(allPaths(), [
    { pathId: 'interviews-path', rank: 0 },
    { pathId: 'conversations-path', rank: 1 },
  ])
  if (!built.ok) throw new Error(`Invalid overview fixture: ${built.error.code}`)
  return built.value
}

class PreferenceQuery implements PromiseLike<{ data: unknown; error: { code: string } | null }> {
  readonly operations: { method: string; args: unknown[] }[] = []

  constructor(
    private readonly data: unknown,
    private readonly error: { code: string } | null,
  ) {}

  select(columns: string): this {
    this.operations.push({ method: 'select', args: [columns] })
    return this
  }

  eq(column: string, value: unknown): this {
    this.operations.push({ method: 'eq', args: [column, value] })
    return this
  }

  order(column: string, options: { ascending: boolean }): this {
    this.operations.push({ method: 'order', args: [column, options] })
    return this
  }

  then<TResult1 = { data: unknown; error: { code: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown
          error: { code: string } | null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.data, error: this.error }).then(onfulfilled, onrejected)
  }
}

function preferenceClient(data: unknown, error: { code: string } | null = null) {
  const query = new PreferenceQuery(data, error)
  const insert = vi.fn()
  const update = vi.fn()
  const rpc = vi.fn()
  const client = {
    from: vi.fn(() => query),
    insert,
    update,
    rpc,
  } as unknown as SupabaseClient<Database>
  return { client, query, insert, update, rpc }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('curriculum overview ordering', () => {
  it('uses canonical track order regardless of historical preferences', () => {
    const built = buildCurriculumOverview(allPaths().reverse(), [
      { pathId: 'conversations-path', rank: 1 },
      { pathId: 'interviews-path', rank: 0 },
    ])

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.value.paths.map((item) => item.progress.path.slug)).toEqual([
      'general-speaking',
      'interviews',
      'presentations',
      'conversations',
    ])
  })

  it('retains strict preference parsing for backwards-compatible account data helpers', () => {
    expect(parseCurriculumPreferenceRows([{ path_id: '', rank: 0 }])).toBeNull()
    expect(
      parseCurriculumPreferenceRows([{ path_id: 'general-speaking-path', rank: '0' }]),
    ).toBeNull()
    expect(parseCurriculumPreferenceRows([{ path_id: 'general-speaking-path', rank: 0 }])).toEqual([
      { pathId: 'general-speaking-path', rank: 0 },
    ])
  })

  it('fails closed when a chapter is inactive', () => {
    const general = definition('general-speaking')
    const inactiveChapter = emptyProgress({
      ...general,
      chapters: general.chapters.map((chapter, index) =>
        index === 0 ? { ...chapter, active: false } : chapter,
      ),
    })

    expect(
      buildCurriculumOverview(
        [inactiveChapter, ...allPaths().filter((item) => item.path.slug !== 'general-speaking')],
        [],
      ),
    ).toMatchObject({ ok: false, error: { code: 'inactive_path' } })
  })

  it('fails closed when a lesson is inactive', () => {
    const general = definition('general-speaking')
    const inactiveLesson = emptyProgress({
      ...general,
      chapters: general.chapters.map((chapter, chapterIndex) =>
        chapterIndex === 0
          ? {
              ...chapter,
              lessons: chapter.lessons.map((lesson, lessonIndex) =>
                lessonIndex === 0 ? { ...lesson, active: false } : lesson,
              ),
            }
          : chapter,
      ),
    })

    expect(
      buildCurriculumOverview(
        [inactiveLesson, ...allPaths().filter((item) => item.path.slug !== 'general-speaking')],
        [],
      ),
    ).toMatchObject({ ok: false, error: { code: 'inactive_path' } })
  })
})

describe('curriculum overview server boundary', () => {
  it('loads every path without reading or mutating historical preferences', async () => {
    const setup = preferenceClient([
      { path_id: 'interviews-path', rank: 0 },
      { path_id: 'conversations-path', rank: 1 },
    ])
    const paths = new Map(allPaths().map((item) => [item.path.slug, item]))
    const pathLoaderMock = vi.fn(async (_client, _userId, slug: PathSlug) => ({
      status: 'ready' as const,
      data: paths.get(slug) as CurriculumPathProgress,
    }))
    const pathLoader: CurriculumPathLoader = pathLoaderMock

    const result = await loadCurriculumOverviewForUser(setup.client, USER_ID, pathLoader)

    expect(result.status).toBe('ready')
    expect(setup.client.from).not.toHaveBeenCalled()
    expect(pathLoader).toHaveBeenCalledTimes(PATH_SLUGS.length)
    expect(pathLoaderMock.mock.calls.map((call) => call[2])).toEqual(PATH_SLUGS)
    expect(setup.insert).not.toHaveBeenCalled()
    expect(setup.update).not.toHaveBeenCalled()
    expect(setup.rpc).not.toHaveBeenCalled()
  })

  it('keeps path failures typed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const valid = preferenceClient([])
    const failedLoader = vi.fn(async () => ({
      status: 'failure' as const,
      reason: 'query' as const,
      operation: 'lessons' as const,
    })) as CurriculumPathLoader
    await expect(
      loadCurriculumOverviewForUser(valid.client, USER_ID, failedLoader),
    ).resolves.toEqual({ status: 'failure', reason: 'query', operation: 'lessons' })
  })
})

describe('Home curriculum overview', () => {
  it('shows each track in order with only its immediate lesson and direct action', () => {
    const { container } = render(<HomeOverview overview={overview()} />)

    expect(screen.getByRole('heading', { name: 'Home', level: 1 })).toHaveClass(
      'prompt-display',
      'text-2xl',
    )
    const tracks = screen.getByRole('region', { name: 'Home' })
    expect(
      within(tracks)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['General Speaking', 'Interviews', 'Presentations', 'Conversations'])
    for (const slug of PATH_SLUGS) {
      expect(container.querySelector(`[data-track-icon="${slug}"]`)).toBeInTheDocument()
    }
    expect(
      screen.getByText('Build clear, focused responses for everyday speaking.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Answer questions directly with specific support.')).toBeInTheDocument()
    expect(screen.getByText('Structure ideas for a clear spoken delivery.')).toBeInTheDocument()
    expect(screen.getByText('Respond naturally and keep ideas moving.')).toBeInTheDocument()
    expect(screen.queryByText('Primary path')).not.toBeInTheDocument()
    expect(screen.queryByText('Selected path')).not.toBeInTheDocument()
    expect(screen.queryByText('Available')).not.toBeInTheDocument()
    expect(screen.queryByText('Interviews lesson 1')).not.toBeInTheDocument()
    expect(screen.getAllByText('Lesson 1 of 10')).not.toHaveLength(0)
    expect(screen.getAllByText('Current lesson')).toHaveLength(3)
    expect(screen.queryByText('Interviews beginner')).not.toBeInTheDocument()
    expect(screen.queryByText('Best 64 · Need 70')).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ \/ 10 passed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ \/ 30 passed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ \/ 90 stars/)).not.toBeInTheDocument()
    expect(screen.queryByText('Not passed yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /stars/ })).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Start Lesson' })).toHaveAttribute(
      'href',
      '/practice/paths/general-speaking/lessons/general-speaking-beginner-01-skill-1/record',
    )
    expect(screen.getByRole('link', { name: 'Try Again' })).toHaveAttribute(
      'href',
      '/practice/paths/interviews/lessons/interviews-beginner-01-skill-1/record?retry=attempt-interviews-1',
    )
    expect(screen.getByRole('link', { name: 'Next Lesson' })).toHaveAttribute(
      'href',
      '/practice/paths/conversations/lessons/conversations-beginner-03-skill-3/record',
    )
    expect(screen.getByRole('link', { name: 'Practice Again' })).toHaveAttribute(
      'href',
      '/practice/paths/presentations/lessons/presentations-beginner-01-skill-1/record',
    )
    expect(screen.getByText('Path complete')).toBeInTheDocument()
  })

  it('makes only the two explicit card actions interactive', () => {
    const { container } = render(<HomeOverview overview={overview()} />)

    expect(screen.queryByRole('link', { name: /View .* track/ })).not.toBeInTheDocument()
    expect(container.querySelectorAll('a a')).toHaveLength(0)
    expect(
      screen
        .getAllByRole('link', { name: 'View Lessons' })
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/practice/paths/general-speaking',
      '/practice/paths/interviews',
      '/practice/paths/presentations',
      '/practice/paths/conversations',
    ])
    for (const link of screen.getAllByRole('link', { name: 'View Lessons' })) {
      expect(link).toHaveClass(
        'border',
        'bg-surface',
        'hover:bg-surface-sunken',
        'active:bg-accent-soft',
      )
      expect(link).not.toHaveClass('bg-accent')
    }
    expect(screen.getAllByRole('link')).toHaveLength(9)
  })

  it('keeps neutral activity in the action state without adding status copy', () => {
    const paths = allPaths().map((item) =>
      item.path.slug === 'general-speaking'
        ? progress('general-speaking', { neutral: true })
        : item,
    )
    const built = buildCurriculumOverview(paths, [])
    if (!built.ok) throw new Error(`Invalid neutral overview fixture: ${built.error.code}`)

    render(<HomeOverview overview={built.value} />)

    expect(screen.queryByText('You have activity here, but no score.')).not.toBeInTheDocument()
    expect(screen.queryByText('Your last response was not scored.')).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: 'Try Again' }).map((link) => link.getAttribute('href')),
    ).toContain(
      '/practice/paths/general-speaking/lessons/general-speaking-beginner-01-skill-1/record',
    )
  })

  it('removes standalone Practice discovery while keeping Custom Prompt below tracks', () => {
    render(<HomeOverview overview={overview()} />)

    expect(screen.queryByRole('region', { name: 'Practice' })).not.toBeInTheDocument()
    for (const label of [
      'General Practice',
      'Interview Practice',
      'Presentation Practice',
      'Conversation Practice',
    ]) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
    }
    expect(screen.getByText('Practice with your own custom prompt')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Enter a custom prompt' })).toHaveAttribute(
      'href',
      '/practice/custom',
    )
  })

  it('uses mobile-safe wrapping, semantic tokens, and the existing free-practice boundary', () => {
    const component = readFileSync('src/components/curriculum/home-overview.tsx', 'utf8')
    const page = readFileSync('src/app/(app)/home/page.tsx', 'utf8')
    const promptServer = readFileSync('src/lib/prompts/server.ts', 'utf8')

    expect(component).toContain('grid min-w-0')
    expect(component).toContain('break-words')
    expect(component).toContain('text-foreground')
    expect(component).toContain('text-muted')
    expect(component).not.toMatch(/(?:bg|text|border)-(?:red|blue|green|yellow|gray)-/)
    expect(page).toContain('<RetryButton />')
    expect(page).toContain("redirect('/login')")
    expect(promptServer).toContain(".eq('free_practice_visible', true)")
  })
})
