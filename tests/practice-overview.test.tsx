// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PracticeOverview } from '@/components/curriculum/practice-overview'
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
    stored.push({ lessonId: current.id, bestScore: options.retryScore, bestAttemptId: null })
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

describe('curriculum overview preference ordering', () => {
  it('puts the primary path first, selected secondaries by rank, and others canonically', () => {
    const built = buildCurriculumOverview(allPaths().reverse(), [
      { pathId: 'conversations-path', rank: 1 },
      { pathId: 'interviews-path', rank: 0 },
    ])

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.value.paths.map((item) => item.progress.path.slug)).toEqual([
      'interviews',
      'conversations',
      'general-speaking',
      'presentations',
    ])
    expect(built.value.paths.map((item) => item.selection)).toEqual([
      'primary',
      'selected',
      'available',
      'available',
    ])
  })

  it('uses General Speaking as the sole selected primary for a legitimate empty set', () => {
    const built = buildCurriculumOverview(allPaths(), [])

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.value.usedDefaultPreference).toBe(true)
    expect(built.value.paths[0]).toMatchObject({
      selection: 'primary',
      preferenceRank: 0,
      progress: { path: { slug: 'general-speaking' } },
    })
    expect(built.value.paths.slice(1).every((item) => item.selection === 'available')).toBe(true)
  })

  it('rejects malformed, duplicate, gapped, and unknown preferences instead of guessing', () => {
    expect(parseCurriculumPreferenceRows([{ path_id: '', rank: 0 }])).toBeNull()
    expect(
      parseCurriculumPreferenceRows([{ path_id: 'general-speaking-path', rank: '0' }]),
    ).toBeNull()
    expect(
      buildCurriculumOverview(allPaths(), [
        { pathId: 'interviews-path', rank: 0 },
        { pathId: 'interviews-path', rank: 1 },
      ]),
    ).toMatchObject({ ok: false, error: { code: 'invalid_preference_order' } })
    expect(
      buildCurriculumOverview(allPaths(), [{ pathId: 'interviews-path', rank: 1 }]),
    ).toMatchObject({ ok: false, error: { code: 'invalid_preference_order' } })
    expect(
      buildCurriculumOverview(allPaths(), [{ pathId: 'unknown-path', rank: 0 }]),
    ).toMatchObject({ ok: false, error: { code: 'unknown_preference_path' } })
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
  it('queries preferences for the owner, loads every path, and never mutates preferences', async () => {
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
    expect(setup.client.from).toHaveBeenCalledWith('profile_path_preferences')
    expect(setup.query.operations).toEqual([
      { method: 'select', args: ['path_id, rank'] },
      { method: 'eq', args: ['user_id', USER_ID] },
      { method: 'order', args: ['rank', { ascending: true }] },
    ])
    expect(pathLoader).toHaveBeenCalledTimes(PATH_SLUGS.length)
    expect(pathLoaderMock.mock.calls.map((call) => call[2])).toEqual(PATH_SLUGS)
    expect(setup.insert).not.toHaveBeenCalled()
    expect(setup.update).not.toHaveBeenCalled()
    expect(setup.rpc).not.toHaveBeenCalled()
  })

  it('keeps preference query failure distinct and does not load guessed paths', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const setup = preferenceClient(null, { code: 'NETWORK' })
    const pathLoader = vi.fn() as CurriculumPathLoader

    const result = await loadCurriculumOverviewForUser(setup.client, USER_ID, pathLoader)

    expect(result).toEqual({ status: 'failure', reason: 'query', operation: 'preferences' })
    expect(pathLoader).not.toHaveBeenCalled()
  })

  it('keeps malformed preferences and path failures typed instead of treating them as empty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const malformed = preferenceClient([{ path_id: 'interviews-path', rank: '0' }])
    const pathLoader = vi.fn() as CurriculumPathLoader
    await expect(
      loadCurriculumOverviewForUser(malformed.client, USER_ID, pathLoader),
    ).resolves.toEqual({ status: 'failure', reason: 'invalid_response', operation: 'preferences' })
    expect(pathLoader).not.toHaveBeenCalled()

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

describe('Practice overview', () => {
  it('shows path order, status, progress, current lessons, and state-specific actions', () => {
    render(<PracticeOverview overview={overview()} />)

    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Interviews', 'Conversations', 'General Speaking', 'Presentations'])
    expect(screen.getByText('Primary path')).toBeInTheDocument()
    expect(screen.getByText('Selected path')).toBeInTheDocument()
    expect(screen.getAllByText('Available')).toHaveLength(2)
    expect(screen.getByText('Interviews lesson 1')).toBeInTheDocument()
    expect(screen.getByText('Interviews beginner')).toBeInTheDocument()
    expect(screen.getByText('Best 64 · Need 70')).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: '0 of 3 stars' })).toHaveLength(3)

    expect(screen.getByRole('link', { name: 'Try Again' })).toHaveAttribute(
      'href',
      '/practice/paths/interviews/lessons/interviews-beginner-01-skill-1',
    )
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/practice/paths/conversations/lessons/conversations-beginner-03-skill-3',
    )
    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      '/practice/paths/general-speaking/lessons/general-speaking-beginner-01-skill-1',
    )
    expect(screen.getByRole('link', { name: 'View Path' })).toHaveAttribute(
      'href',
      '/practice/paths/presentations',
    )
    expect(screen.getByText('Path complete')).toBeInTheDocument()
    expect(screen.getByText('90 / 90 stars')).toBeInTheDocument()
  })

  it('describes neutral activity without implying which response was most recent', () => {
    const paths = allPaths().map((item) =>
      item.path.slug === 'general-speaking'
        ? progress('general-speaking', { neutral: true })
        : item,
    )
    const built = buildCurriculumOverview(paths, [])
    if (!built.ok) throw new Error(`Invalid neutral overview fixture: ${built.error.code}`)

    render(<PracticeOverview overview={built.value} />)

    expect(screen.getByText('You have activity here, but no score.')).toBeInTheDocument()
    expect(screen.queryByText('Your last response was not scored.')).not.toBeInTheDocument()
  })

  it('keeps all Free Practice libraries and Custom Prompt reachable below paths', () => {
    render(<PracticeOverview overview={overview()} />)
    const freePractice = screen.getByRole('region', { name: 'Free Practice' })

    expect(
      within(freePractice).getByRole('link', { name: 'General Free Practice' }),
    ).toHaveAttribute('href', '/practice/practice')
    expect(
      within(freePractice).getByRole('link', { name: 'Interview Free Practice' }),
    ).toHaveAttribute('href', '/practice/interview')
    expect(
      within(freePractice).getByRole('link', { name: 'Presentation Free Practice' }),
    ).toHaveAttribute('href', '/practice/presentation')
    expect(
      within(freePractice).getByRole('link', { name: 'Conversation Free Practice' }),
    ).toHaveAttribute('href', '/practice/conversation')
    expect(screen.getByRole('link', { name: 'Enter a custom prompt' })).toHaveAttribute(
      'href',
      '/practice/custom',
    )
  })

  it('uses mobile-safe wrapping, semantic tokens, and the existing free-practice boundary', () => {
    const component = readFileSync('src/components/curriculum/practice-overview.tsx', 'utf8')
    const page = readFileSync('src/app/(app)/practice/page.tsx', 'utf8')
    const promptServer = readFileSync('src/lib/prompts/server.ts', 'utf8')

    expect(component).toContain('min-w-0 flex-wrap')
    expect(component).toContain('break-words')
    expect(component).toContain('min-h-11')
    expect(component).toContain('bg-surface-sunken')
    expect(component).not.toMatch(/(?:bg|text|border)-(?:red|blue|green|yellow|gray)-/)
    expect(page).toContain('<RetryButton />')
    expect(page).toContain("redirect('/login')")
    expect(promptServer).toContain(".eq('free_practice_visible', true)")
  })
})
