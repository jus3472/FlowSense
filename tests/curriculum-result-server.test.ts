import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { CurriculumPathProgress } from '@/lib/curriculum/contracts'
import { loadStructuredLessonResultForUser } from '@/lib/curriculum/result-server'
import type { CurriculumPathLoader } from '@/lib/curriculum/server'
import type { Database } from '@/lib/types/database'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const USER_ID = '50000000-0000-4000-8000-000000000005'
const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const LESSON_ID = '20000000-0000-4000-8000-000000000002'
const CHAPTER_ID = '30000000-0000-4000-8000-000000000003'
const PATH_ID = '40000000-0000-4000-8000-000000000004'
const PROMPT_ID = '60000000-0000-4000-8000-000000000006'

function resultInput(
  overrides: Partial<{
    lessonId: string
    attemptId: string
    promptId: unknown
    practiceMode: unknown
    rubricVersion: unknown
    currentScore: unknown
    snapshotMode: unknown
    snapshotRubricVersion: unknown
    snapshotScore: unknown
  }> = {},
) {
  return {
    lessonId: LESSON_ID,
    attemptId: ATTEMPT_ID,
    promptId: PROMPT_ID,
    practiceMode: 'practice',
    rubricVersion: 'v2',
    currentScore: 84,
    snapshotMode: 'practice',
    snapshotRubricVersion: 'v2',
    snapshotScore: 84,
    ...overrides,
  }
}

function topology(bestAttemptId: string | null = ATTEMPT_ID): CurriculumPathProgress {
  const lessonDefinition = {
    id: LESSON_ID,
    chapterId: CHAPTER_ID,
    slug: 'general-speaking-beginner-01-start',
    title: 'Start clearly',
    skillFocus: 'Open directly',
    position: 1,
    checkpoint: false,
    promptId: PROMPT_ID,
    active: true,
  }
  const chapterDefinition = {
    id: CHAPTER_ID,
    pathId: PATH_ID,
    level: 'beginner' as const,
    title: 'Beginner',
    position: 1,
    active: true,
    lessons: [lessonDefinition],
  }
  const lesson = {
    lesson: lessonDefinition,
    state: 'passed' as const,
    bestScore: 84,
    bestAttemptId,
    stars: 2 as const,
    passed: true,
    attempted: true,
    attemptStatus: 'scored' as const,
    checkpoint: false,
    previousLesson: null,
    nextLesson: null,
  }
  return {
    path: {
      id: PATH_ID,
      slug: 'general-speaking',
      title: 'General Speaking',
      mode: 'practice',
      position: 1,
      active: true,
      chapters: [chapterDefinition],
    },
    lessons: [lesson],
    chapters: [
      {
        chapter: chapterDefinition,
        totalLessons: 1,
        attemptedLessons: 1,
        passedLessons: 1,
        masteredLessons: 0,
        earnedStars: 2,
        maximumStars: 3,
        checkpointState: 'passed',
        chapterUnlocked: true,
        chapterComplete: false,
        currentLesson: null,
      },
    ],
    summary: {
      totalLessons: 1,
      attemptedLessons: 1,
      passedLessons: 1,
      masteredLessons: 0,
      earnedStars: 2,
      maximumStars: 3,
      currentChapter: null,
      currentLesson: null,
      pathComplete: false,
      nextAction: { kind: 'complete' },
    },
  }
}

function fakeClient(input?: {
  lesson?: Record<string, unknown> | null
  chapter?: Record<string, unknown> | null
  path?: Record<string, unknown> | null
  errorTable?: string
}) {
  const selected = (
    key: 'lesson' | 'chapter' | 'path',
    fallback: Record<string, unknown>,
  ): Record<string, unknown> | null =>
    input && Object.prototype.hasOwnProperty.call(input, key) ? (input[key] ?? null) : fallback
  const rows: Record<string, Record<string, unknown> | null> = {
    practice_lessons: selected('lesson', { id: LESSON_ID, chapter_id: CHAPTER_ID }),
    practice_chapters: selected('chapter', { id: CHAPTER_ID, path_id: PATH_ID }),
    practice_paths: selected('path', { id: PATH_ID, slug: 'general-speaking' }),
  }
  const filters: Array<{ table: string; column: string; value: unknown }> = []
  const client = {
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          filters.push({ table, column, value })
          return query
        }),
        maybeSingle: vi.fn(async () => ({
          data: rows[table] ?? null,
          error: input?.errorTable === table ? { code: 'FAKE_QUERY_FAILURE' } : null,
        })),
      }
      return query
    }),
  } as unknown as SupabaseClient<Database>
  return { client, filters }
}

describe('structured lesson result server identity', () => {
  it('resolves lesson to chapter to path before loading owner-scoped topology', async () => {
    const setup = fakeClient()
    const pathLoader = vi.fn(async () => ({ status: 'ready' as const, data: topology() }))

    const outcome = await loadStructuredLessonResultForUser(
      setup.client,
      USER_ID,
      resultInput(),
      pathLoader as CurriculumPathLoader,
    )

    expect(outcome).toMatchObject({
      status: 'ready',
      data: {
        state: 'passed',
        bestScore: 84,
        bestAttemptId: ATTEMPT_ID,
        personalBest: true,
      },
    })
    expect(setup.filters).toEqual([
      { table: 'practice_lessons', column: 'id', value: LESSON_ID },
      { table: 'practice_chapters', column: 'id', value: CHAPTER_ID },
      { table: 'practice_paths', column: 'id', value: PATH_ID },
    ])
    expect(pathLoader).toHaveBeenCalledWith(setup.client, USER_ID, 'general-speaking')
  })

  it('preserves a durable best after its attempt link was deleted', async () => {
    const setup = fakeClient()
    const pathLoader = vi.fn(async () => ({ status: 'ready' as const, data: topology(null) }))

    const outcome = await loadStructuredLessonResultForUser(
      setup.client,
      USER_ID,
      resultInput({ currentScore: 72, snapshotScore: 72 }),
      pathLoader as CurriculumPathLoader,
    )

    expect(outcome).toMatchObject({
      status: 'ready',
      data: {
        currentScore: 72,
        bestScore: 84,
        bestStars: 2,
        bestAttemptId: null,
        personalBest: false,
      },
    })
  })

  it.each([
    { label: 'prompt', override: { promptId: 'wrong-prompt' } },
    { label: 'attempt mode', override: { practiceMode: 'interview' } },
    { label: 'snapshot mode', override: { snapshotMode: 'interview' } },
    { label: 'attempt rubric', override: { rubricVersion: null } },
    { label: 'snapshot rubric', override: { snapshotRubricVersion: 'legacy' } },
  ])('keeps a mismatched $label identity neutral', async ({ override }) => {
    const setup = fakeClient()
    const pathLoader = vi.fn(async () => ({ status: 'ready' as const, data: topology() }))

    const outcome = await loadStructuredLessonResultForUser(
      setup.client,
      USER_ID,
      resultInput(override),
      pathLoader as CurriculumPathLoader,
    )

    expect(outcome).toMatchObject({
      status: 'ready',
      data: {
        state: 'neutral',
        currentScore: null,
        currentStars: 0,
        bestScore: 84,
        primaryAction: { label: 'Try Again' },
      },
    })
  })

  it('returns not found without loading topology when the lesson identity is absent', async () => {
    const setup = fakeClient({ lesson: null })
    const pathLoader = vi.fn()

    await expect(
      loadStructuredLessonResultForUser(
        setup.client,
        USER_ID,
        resultInput(),
        pathLoader as CurriculumPathLoader,
      ),
    ).resolves.toEqual({ status: 'not_found' })
    expect(pathLoader).not.toHaveBeenCalled()
  })

  it('reports query failure separately from a neutral scoring result', async () => {
    const setup = fakeClient({ errorTable: 'practice_chapters' })
    const pathLoader = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      loadStructuredLessonResultForUser(
        setup.client,
        USER_ID,
        resultInput({ currentScore: null, snapshotScore: null }),
        pathLoader as CurriculumPathLoader,
      ),
    ).resolves.toEqual({ status: 'failure', operation: 'chapter' })
    expect(pathLoader).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('[curriculum] result context load failed', {
      operation: 'chapter',
      code: 'FAKE_QUERY_FAILURE',
    })
    consoleError.mockRestore()
  })
})
