import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  loadRecentStructuredLessonId,
  logRecentStructuredLessonFailure,
} from '@/lib/home/recent-lesson'
import type { Database } from '@/lib/types/database'
import { v3Snapshot } from './helpers/result-snapshots'

vi.mock('server-only', () => ({}))

interface Row {
  id: string
  user_id: string
  lesson_id: string | null
  status: string
  duration_ms: number | null
  transcript: string | null
  score: number | null
  section_scores: unknown
}

interface Operation {
  method: string
  args: unknown[]
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'attempt-1',
    user_id: 'user-1',
    lesson_id: 'interviews-lesson-1',
    status: 'done',
    duration_ms: 12_000,
    transcript: 'I gave one concrete example.',
    score: 80,
    section_scores: v3Snapshot(),
    ...overrides,
  }
}

class FakeQuery implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  readonly operations: Operation[] = []

  constructor(
    private readonly rows: Row[],
    private readonly error: unknown = null,
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

  not(column: string, operator: string, value: unknown): this {
    return this.add('not', column, operator, value)
  }

  order(column: string, options: unknown): this {
    return this.add('order', column, options)
  }

  range(from: number, to: number): this {
    return this.add('range', from, to)
  }

  then<TResult1 = { data: Row[] | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      ((value: { data: Row[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    let output = [...this.rows]
    for (const operation of this.operations) {
      const [column, value] = operation.args
      if (operation.method === 'eq') {
        output = output.filter((item) => item[column as keyof Row] === value)
      }
      if (operation.method === 'not' && column === 'lesson_id') {
        output = output.filter((item) => item.lesson_id !== null)
      }
    }
    const range = this.operations.find((operation) => operation.method === 'range')
    if (range) output = output.slice(Number(range.args[0]), Number(range.args[1]) + 1)
    return Promise.resolve({ data: this.error ? null : output, error: this.error }).then(
      onfulfilled,
      onrejected,
    )
  }
}

function setup(rows: Row[], error: unknown = null) {
  const query = new FakeQuery(rows, error)
  const client = { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>
  return { client, query }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('recent structured lesson loading', () => {
  it('returns the newest relevant completed structured activity', async () => {
    const { client, query } = setup([
      row({ id: 'custom', lesson_id: null }),
      row({ id: 'active', status: 'scoring', lesson_id: 'presentations-lesson-1' }),
      row({ id: 'owned-by-another-user', user_id: 'user-2' }),
      row({ id: 'newest-valid', lesson_id: 'conversations-lesson-4' }),
      row({ id: 'older-valid', lesson_id: 'interviews-lesson-1' }),
    ])

    await expect(loadRecentStructuredLessonId(client, 'user-1')).resolves.toEqual({
      status: 'ready',
      lessonId: 'conversations-lesson-4',
    })
    expect(query.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['user_id', 'user-1'] },
        { method: 'eq', args: ['status', 'done'] },
        { method: 'not', args: ['lesson_id', 'is', null] },
        {
          method: 'order',
          args: ['finished_at', { ascending: false, nullsFirst: false }],
        },
        { method: 'order', args: ['id', { ascending: false }] },
      ]),
    )
  })

  it('skips malformed activity and accepts the next valid structured response', async () => {
    const validSnapshot = v3Snapshot({ component: 0.64 })
    const { client } = setup([
      row({ id: 'invalid-newest', lesson_id: 'presentations-lesson-2', transcript: '   ' }),
      row({
        id: 'valid-older',
        lesson_id: 'interviews-lesson-3',
        score: validSnapshot.total_earned_points,
        section_scores: validSnapshot,
      }),
    ])

    await expect(loadRecentStructuredLessonId(client, 'user-1')).resolves.toEqual({
      status: 'ready',
      lessonId: 'interviews-lesson-3',
    })
  })

  it('returns no lesson when only custom or non-completed responses exist', async () => {
    const { client } = setup([
      row({ id: 'custom', lesson_id: null }),
      row({ id: 'active', status: 'uploading' }),
    ])

    await expect(loadRecentStructuredLessonId(client, 'user-1')).resolves.toEqual({
      status: 'ready',
      lessonId: null,
    })
  })

  it('reports query failures without logging private database text', async () => {
    const failure = { code: 'PGRST500', message: 'private database detail' }
    const { client } = setup([], failure)
    const result = await loadRecentStructuredLessonId(client, 'user-1')
    expect(result).toEqual({ status: 'failure', reason: 'query', error: failure })
    if (result.status !== 'failure') throw new Error('expected failure')

    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logRecentStructuredLessonFailure(result)
    expect(logging).toHaveBeenCalledWith('[home] recent structured lesson load failed', {
      reason: 'query',
      code: 'PGRST500',
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain('private database detail')
  })
})
