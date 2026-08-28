import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  curriculumPromptOutcome,
  parseCurriculumPathRows,
  parseLessonProgressRows,
} from '@/lib/curriculum/data'
import {
  CURRICULUM_ATTEMPT_PAGE_SIZE,
  loadAuthenticatedCurriculumLessonAccess,
  loadAuthenticatedCurriculumPath,
  loadCurriculumLessonAccessForUser,
  loadCurriculumPathForUser,
} from '@/lib/curriculum/server'
import type { Database } from '@/lib/types/database'
import { v2Snapshot } from './helpers/result-snapshots'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

type FakeRow = Record<string, unknown>

interface Operation {
  method: string
  args: unknown[]
}

interface FakeTables {
  practice_paths: FakeRow[]
  practice_chapters: FakeRow[]
  practice_lessons: FakeRow[]
  lesson_progress: FakeRow[]
  attempts: FakeRow[]
  prompts: FakeRow[]
}

class FakeQuery implements PromiseLike<{ data: FakeRow[] | FakeRow | null; error: unknown }> {
  readonly operations: Operation[] = []
  private single = false

  constructor(
    readonly table: keyof FakeTables,
    private readonly rows: readonly FakeRow[],
    private readonly failTable: keyof FakeTables | null,
  ) {}

  private add(method: string, ...args: unknown[]): this {
    this.operations.push({ method, args })
    return this
  }

  select(columns: string): this {
    return this.add('select', columns)
  }

  eq(column: string, value: unknown): this {
    return this.add('eq', column, value)
  }

  is(column: string, value: unknown): this {
    return this.add('is', column, value)
  }

  in(column: string, values: readonly unknown[]): this {
    return this.add('in', column, values)
  }

  order(column: string, options: { ascending: boolean }): this {
    return this.add('order', column, options)
  }

  range(from: number, to: number): this {
    return this.add('range', from, to)
  }

  maybeSingle(): this {
    this.single = true
    return this
  }

  then<TResult1 = { data: FakeRow[] | FakeRow | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: FakeRow[] | FakeRow | null
          error: unknown
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.table === this.failTable) {
      return Promise.resolve({ data: null, error: { code: 'FAKE_QUERY_FAILURE' } }).then(
        onfulfilled,
        onrejected,
      )
    }

    let output = [...this.rows]
    for (const operation of this.operations) {
      const [column, value] = operation.args
      if (operation.method === 'eq') {
        output = output.filter((row) => row[String(column)] === value)
      }
      if (operation.method === 'is') {
        output = output.filter((row) => row[String(column)] === value)
      }
      if (operation.method === 'in') {
        output = output.filter((row) => (value as readonly unknown[]).includes(row[String(column)]))
      }
    }
    const orders = this.operations.filter((operation) => operation.method === 'order')
    for (const operation of [...orders].reverse()) {
      const [column, options] = operation.args as [string, { ascending: boolean }]
      output.sort((left, right) => {
        const comparison = String(left[column]).localeCompare(String(right[column]))
        return options.ascending ? comparison : -comparison
      })
    }
    const range = this.operations.find((operation) => operation.method === 'range')
    if (range) output = output.slice(Number(range.args[0]), Number(range.args[1]) + 1)

    const result = this.single ? (output[0] ?? null) : output
    return Promise.resolve({ data: result, error: null }).then(onfulfilled, onrejected)
  }
}

function uuid(index: number): string {
  return `00000000-0000-5000-8000-${String(index).padStart(12, '0')}`
}

const USER_ID = uuid(900)
const OTHER_USER_ID = uuid(901)
const PATH_ID = uuid(1)
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const

function curriculumTables(): FakeTables {
  const chapters = LEVELS.map((level, index) => ({
    id: uuid(index + 2),
    path_id: PATH_ID,
    level,
    title: `${level} chapter`,
    position: index + 1,
    active: true,
  }))
  const lessons = chapters.flatMap((chapter, chapterIndex) =>
    Array.from({ length: 10 }, (_, lessonIndex) => {
      const position = lessonIndex + 1
      const sequence = chapterIndex * 10 + position
      return {
        id: uuid(10 + sequence),
        chapter_id: chapter.id,
        slug: `general-speaking-${chapter.level}-${String(position).padStart(2, '0')}-skill-${sequence}`,
        title: `Lesson ${sequence}`,
        skill_focus: `Focus ${sequence}`,
        position,
        checkpoint: position === 10,
        prompt_id: uuid(100 + sequence),
        active: true,
      }
    }),
  )
  return {
    practice_paths: [
      {
        id: PATH_ID,
        slug: 'general-speaking',
        title: 'General Speaking',
        mode: 'practice',
        position: 1,
        active: true,
      },
    ],
    practice_chapters: chapters,
    practice_lessons: lessons,
    lesson_progress: [],
    attempts: [],
    prompts: lessons.map((lesson, index) => ({
      id: lesson.prompt_id,
      text: `Prompt ${index + 1}`,
      active: true,
      mode: 'practice',
      difficulty: LEVELS[Math.floor(index / 10)],
      target_duration_seconds: 45,
      free_practice_visible: false,
    })),
  }
}

function fakeSupabase(tables: FakeTables, failTable: keyof FakeTables | null = null) {
  const queries: FakeQuery[] = []
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: (table: keyof FakeTables) => {
      const query = new FakeQuery(table, tables[table], failTable)
      queries.push(query)
      return query
    },
  } as unknown as SupabaseClient<Database>
  return { client, queries }
}

function lesson(tables: FakeTables, index: number): FakeRow {
  const row = tables.practice_lessons[index]
  if (!row) throw new Error(`missing lesson ${index}`)
  return row
}

function pass(tables: FakeTables, lessonIndex: number, score = 74): void {
  tables.lesson_progress.push({
    user_id: USER_ID,
    lesson_id: lesson(tables, lessonIndex).id,
    best_score: score,
    best_attempt_id: uuid(600 + lessonIndex),
  })
}

function neutralAttempt(over: Partial<FakeRow> = {}): FakeRow {
  return {
    id: uuid(700),
    user_id: USER_ID,
    lesson_id: uuid(11),
    status: 'done',
    duration_ms: 20_000,
    transcript: 'A complete response.',
    score: null,
    section_scores: v2Snapshot({ notCheckedCategory: 'grammar' }),
    created_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('curriculum database parsing', () => {
  it('builds a nested 3 by 10 definition and rejects mismatched query rows', () => {
    const tables = curriculumTables()
    const parsed = parseCurriculumPathRows({
      path: tables.practice_paths[0],
      chapters: tables.practice_chapters,
      lessons: tables.practice_lessons,
    })
    expect(parsed?.chapters.map((chapter) => chapter.lessons.length)).toEqual([10, 10, 10])

    const wrongChapter = { ...tables.practice_chapters[0], path_id: uuid(999) }
    expect(
      parseCurriculumPathRows({
        path: tables.practice_paths[0],
        chapters: [wrongChapter, ...tables.practice_chapters.slice(1)],
        lessons: tables.practice_lessons,
      }),
    ).toBeNull()

    const extraLesson = { ...tables.practice_lessons[0], id: uuid(998), chapter_id: uuid(997) }
    expect(
      parseCurriculumPathRows({
        path: tables.practice_paths[0],
        chapters: tables.practice_chapters,
        lessons: [...tables.practice_lessons, extraLesson],
      }),
    ).toBeNull()
  })

  it('preserves unknown score fields for the central progression validator', () => {
    expect(
      parseLessonProgressRows([
        { lesson_id: uuid(11), best_score: '70', best_attempt_id: uuid(500) },
      ]),
    ).toEqual([{ lessonId: uuid(11), bestScore: '70', bestAttemptId: uuid(500) }])
    expect(parseLessonProgressRows([{ lesson_id: null }])).toBeNull()
  })

  it('requires a complete matching curriculum prompt before reporting inactivity', () => {
    const expected = {
      lessonId: uuid(11),
      promptId: uuid(101),
      mode: 'practice' as const,
      difficulty: 'beginner' as const,
    }
    expect(curriculumPromptOutcome({ active: false }, expected)).toEqual({
      status: 'invalid_response',
    })
    expect(
      curriculumPromptOutcome(
        {
          id: uuid(101),
          text: 'Prompt',
          active: false,
          mode: 'practice',
          difficulty: 'beginner',
          target_duration_seconds: 30,
          free_practice_visible: false,
        },
        expected,
      ),
    ).toEqual({ status: 'denied', reason: 'inactive' })
  })
})

describe('curriculum path loader', () => {
  it('starts existing users at Beginner lesson one without using preferences', async () => {
    const setup = fakeSupabase(curriculumTables())
    const result = await loadCurriculumPathForUser(setup.client, USER_ID, 'general-speaking')
    if (result.status !== 'ready') throw new Error(`unexpected ${result.status}`)
    expect(result.data.lessons[0]).toMatchObject({
      state: 'available',
      attempted: false,
      attemptStatus: 'none',
    })
    expect(result.data.lessons[1]?.state).toBe('locked')
    expect(setup.queries.map((query) => query.table)).not.toContain('profile_path_preferences')
    for (const table of ['lesson_progress', 'attempts'] as const) {
      const query = setup.queries.find((candidate) => candidate.table === table)
      expect(query?.operations).toContainEqual({ method: 'eq', args: ['user_id', USER_ID] })
    }
  })

  it('uses permanent progress only for scores and neutral evidence only for attempted state', async () => {
    const tables = curriculumTables()
    tables.attempts.push(
      neutralAttempt(),
      neutralAttempt({
        id: uuid(701),
        user_id: OTHER_USER_ID,
        lesson_id: lesson(tables, 1).id,
      }),
      neutralAttempt({ id: uuid(702), lesson_id: null }),
    )
    const setup = fakeSupabase(tables)
    const result = await loadCurriculumPathForUser(setup.client, USER_ID, 'general-speaking')
    if (result.status !== 'ready') throw new Error(`unexpected ${result.status}`)
    expect(result.data.lessons[0]).toMatchObject({
      state: 'available',
      bestScore: null,
      stars: 0,
      passed: false,
      attempted: true,
      attemptStatus: 'neutral',
    })
    expect(result.data.lessons[1]).toMatchObject({ state: 'locked', attempted: false })
  })

  it('pages until it finds neutral evidence instead of silently truncating', async () => {
    const tables = curriculumTables()
    tables.attempts = Array.from({ length: CURRICULUM_ATTEMPT_PAGE_SIZE }, (_, index) =>
      neutralAttempt({
        id: uuid(700 + index),
        duration_ms: 0,
        created_at: new Date(Date.UTC(2026, 7, 28, 0, 0, index)).toISOString(),
      }),
    )
    tables.attempts.push(
      neutralAttempt({
        id: uuid(850),
        created_at: '2026-08-28T00:10:00.000Z',
      }),
    )
    const setup = fakeSupabase(tables)
    const result = await loadCurriculumPathForUser(setup.client, USER_ID, 'general-speaking')
    if (result.status !== 'ready') throw new Error(`unexpected ${result.status}`)
    expect(result.data.lessons[0]?.attemptStatus).toBe('neutral')
    expect(
      setup.queries
        .filter((query) => query.table === 'attempts')
        .map((query) => query.operations.find((operation) => operation.method === 'range')?.args),
    ).toEqual([
      [0, CURRICULUM_ATTEMPT_PAGE_SIZE - 1],
      [CURRICULUM_ATTEMPT_PAGE_SIZE, CURRICULUM_ATTEMPT_PAGE_SIZE * 2 - 1],
    ])
  })

  it('distinguishes missing, malformed, invalid progress, and query failures', async () => {
    const missingTables = curriculumTables()
    missingTables.practice_paths = []
    await expect(
      loadCurriculumPathForUser(fakeSupabase(missingTables).client, USER_ID, 'general-speaking'),
    ).resolves.toEqual({ status: 'not_found', resource: 'path' })

    const malformed = curriculumTables()
    malformed.practice_lessons.pop()
    await expect(
      loadCurriculumPathForUser(fakeSupabase(malformed).client, USER_ID, 'general-speaking'),
    ).resolves.toMatchObject({ status: 'failure', reason: 'invalid_curriculum' })

    const invalidProgress = curriculumTables()
    invalidProgress.lesson_progress.push({
      user_id: USER_ID,
      lesson_id: lesson(invalidProgress, 0).id,
      best_score: '70',
      best_attempt_id: null,
    })
    await expect(
      loadCurriculumPathForUser(fakeSupabase(invalidProgress).client, USER_ID, 'general-speaking'),
    ).resolves.toMatchObject({ status: 'failure', reason: 'invalid_progress' })

    await expect(
      loadCurriculumPathForUser(
        fakeSupabase(curriculumTables(), 'practice_lessons').client,
        USER_ID,
        'general-speaking',
      ),
    ).resolves.toEqual({ status: 'failure', reason: 'query', operation: 'lessons' })
  })
})

describe('curriculum lesson access', () => {
  it('allows only unlocked lessons and returns authoritative session metadata', async () => {
    const tables = curriculumTables()
    const setup = fakeSupabase(tables)
    const firstSlug = String(lesson(tables, 0).slug)
    await expect(
      loadCurriculumLessonAccessForUser(setup.client, USER_ID, 'general-speaking', firstSlug),
    ).resolves.toEqual({
      status: 'allowed',
      data: {
        session: {
          lessonId: lesson(tables, 0).id,
          promptId: lesson(tables, 0).prompt_id,
          promptText: 'Prompt 1',
          mode: 'practice',
          difficulty: 'beginner',
          targetDurationSeconds: 45,
        },
        lesson: expect.objectContaining({ state: 'available', passed: false }),
      },
    })

    await expect(
      loadCurriculumLessonAccessForUser(
        fakeSupabase(curriculumTables()).client,
        USER_ID,
        'general-speaking',
        String(lesson(tables, 1).slug),
      ),
    ).resolves.toEqual({ status: 'denied', reason: 'locked' })
  })

  it('unlocks the next lesson only from persisted passing progress', async () => {
    const tables = curriculumTables()
    pass(tables, 0)
    await expect(
      loadCurriculumLessonAccessForUser(
        fakeSupabase(tables).client,
        USER_ID,
        'general-speaking',
        String(lesson(tables, 1).slug),
      ),
    ).resolves.toMatchObject({
      status: 'allowed',
      data: { session: { promptText: 'Prompt 2' }, lesson: { state: 'available' } },
    })
  })

  it('rejects inactive path, chapter, lesson, and prompt rows', async () => {
    for (const deactivate of [
      (tables: FakeTables) => {
        const path = tables.practice_paths[0]
        if (path) path.active = false
      },
      (tables: FakeTables) => {
        const chapter = tables.practice_chapters[0]
        if (chapter) chapter.active = false
      },
      (tables: FakeTables) => {
        const target = tables.practice_lessons[0]
        if (target) target.active = false
      },
      (tables: FakeTables) => {
        const prompt = tables.prompts[0]
        if (prompt) prompt.active = false
      },
    ]) {
      const tables = curriculumTables()
      deactivate(tables)
      await expect(
        loadCurriculumLessonAccessForUser(
          fakeSupabase(tables).client,
          USER_ID,
          'general-speaking',
          String(lesson(tables, 0).slug),
        ),
      ).resolves.toEqual({ status: 'denied', reason: 'inactive' })
    }
  })

  it('distinguishes missing lessons, wrong-path lessons, malformed prompts, and query errors', async () => {
    const missing = curriculumTables()
    await expect(
      loadCurriculumLessonAccessForUser(
        fakeSupabase(missing).client,
        USER_ID,
        'general-speaking',
        'general-speaking-beginner-01-missing',
      ),
    ).resolves.toEqual({ status: 'not_found', resource: 'lesson' })

    const wrongPath = curriculumTables()
    wrongPath.practice_lessons.push({
      ...lesson(wrongPath, 0),
      id: uuid(990),
      chapter_id: uuid(991),
      slug: 'interviews-beginner-01-one-point',
      prompt_id: uuid(992),
    })
    await expect(
      loadCurriculumLessonAccessForUser(
        fakeSupabase(wrongPath).client,
        USER_ID,
        'general-speaking',
        'interviews-beginner-01-one-point',
      ),
    ).resolves.toEqual({ status: 'denied', reason: 'path_mismatch' })

    const malformedPrompt = curriculumTables()
    const firstPrompt = malformedPrompt.prompts[0]
    if (firstPrompt) firstPrompt.free_practice_visible = true
    await expect(
      loadCurriculumLessonAccessForUser(
        fakeSupabase(malformedPrompt).client,
        USER_ID,
        'general-speaking',
        String(lesson(malformedPrompt, 0).slug),
      ),
    ).resolves.toEqual({ status: 'failure', reason: 'invalid_response', operation: 'prompt' })

    await expect(
      loadCurriculumLessonAccessForUser(
        fakeSupabase(curriculumTables(), 'prompts').client,
        USER_ID,
        'general-speaking',
        String(lesson(curriculumTables(), 0).slug),
      ),
    ).resolves.toEqual({ status: 'failure', reason: 'query', operation: 'prompt' })
  })
})

describe('authenticated curriculum entry points', () => {
  it('distinguishes no user from an authentication failure', async () => {
    const noUser = fakeSupabase(curriculumTables()).client
    vi.mocked(noUser.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof noUser.auth.getUser>>)
    mocks.createClient.mockResolvedValueOnce(noUser)
    await expect(loadAuthenticatedCurriculumPath('general-speaking')).resolves.toEqual({
      status: 'unauthenticated',
    })

    const missingSession = fakeSupabase(curriculumTables()).client
    vi.mocked(missingSession.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: {
        name: 'AuthSessionMissingError',
        message: 'Auth session missing',
        status: 400,
      },
    } as unknown as Awaited<ReturnType<typeof missingSession.auth.getUser>>)
    mocks.createClient.mockResolvedValueOnce(missingSession)
    await expect(loadAuthenticatedCurriculumPath('general-speaking')).resolves.toEqual({
      status: 'unauthenticated',
    })

    const failed = fakeSupabase(curriculumTables()).client
    vi.mocked(failed.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: { name: 'AuthError', message: 'private message', status: 500 },
    } as unknown as Awaited<ReturnType<typeof failed.auth.getUser>>)
    mocks.createClient.mockResolvedValueOnce(failed)
    await expect(
      loadAuthenticatedCurriculumLessonAccess(
        'general-speaking',
        'general-speaking-beginner-01-skill-1',
      ),
    ).resolves.toEqual({
      status: 'failure',
      reason: 'authentication',
      operation: 'authentication',
    })

    mocks.createClient.mockRejectedValueOnce(new Error('cookie store unavailable'))
    await expect(loadAuthenticatedCurriculumPath('general-speaking')).resolves.toEqual({
      status: 'failure',
      reason: 'authentication',
      operation: 'authentication',
    })
  })
})
