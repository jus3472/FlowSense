import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  HISTORY_PAGE_SIZE,
  HISTORY_SCORE_SCAN_SIZE,
  loadHistoryPage,
} from '@/lib/results/history-server'
import type { Database, Json, PracticeMode, PromptSource } from '@/lib/types/database'

vi.mock('server-only', () => ({}))

interface FakeAttempt {
  id: string
  user_id: string
  created_at: string
  prompt_text: string
  score: number | null
  section_scores: Json | null
  practice_mode: PracticeMode | null
  prompt_source: PromptSource | null
  retry_of_attempt_id: string | null
}

interface Operation {
  method: string
  args: unknown[]
}

function attempt(index: number, over: Partial<FakeAttempt> = {}): FakeAttempt {
  return {
    id: `attempt-${String(index).padStart(3, '0')}`,
    user_id: 'user-1',
    created_at: new Date(Date.UTC(2026, 7, 27, 0, 0, index)).toISOString(),
    prompt_text: `Prompt ${index}`,
    score: 70,
    section_scores: { version: 'stored' },
    practice_mode: 'practice',
    prompt_source: 'library',
    retry_of_attempt_id: null,
    ...over,
  }
}

class FakeQuery implements PromiseLike<{ data: FakeAttempt[] | null; error: unknown }> {
  readonly operations: Operation[] = []

  constructor(
    private readonly rows: FakeAttempt[],
    private readonly shouldFail: (select: string) => boolean,
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

  or(filters: string): this {
    return this.add('or', filters)
  }

  gte(column: string, value: number): this {
    return this.add('gte', column, value)
  }

  lt(column: string, value: number): this {
    return this.add('lt', column, value)
  }

  order(column: string, options: { ascending: boolean }): this {
    return this.add('order', column, options)
  }

  range(from: number, to: number): this {
    return this.add('range', from, to)
  }

  limit(value: number): this {
    return this.add('limit', value)
  }

  then<TResult1 = { data: FakeAttempt[] | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: FakeAttempt[] | null
          error: unknown
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const select = String(
      this.operations.find((operation) => operation.method === 'select')?.args[0],
    )
    if (this.shouldFail(select))
      return Promise.resolve({ data: null, error: { code: 'FAKE_FAILURE' } }).then(
        onfulfilled,
        onrejected,
      )

    let output = [...this.rows]
    for (const operation of this.operations) {
      const [column, value] = operation.args
      if (operation.method === 'eq')
        output = output.filter((row) => row[column as keyof FakeAttempt] === value)
      if (operation.method === 'not' && column === 'score')
        output = output.filter((row) => row.score !== null)
      if (operation.method === 'not' && column === 'retry_of_attempt_id')
        output = output.filter((row) => row.retry_of_attempt_id !== null)
      if (operation.method === 'or' && value === undefined) {
        const filters = String(column)
        if (filters.includes('section_scores'))
          output = output.filter((row) => row.score !== null || row.section_scores !== null)
        if (filters.includes('practice_mode'))
          output = output.filter(
            (row) => row.practice_mode === 'practice' || row.practice_mode === null,
          )
      }
      if (operation.method === 'gte' && column === 'score')
        output = output.filter((row) => row.score !== null && row.score >= Number(value))
      if (operation.method === 'lt' && column === 'score')
        output = output.filter((row) => row.score !== null && row.score < Number(value))
    }
    const orders = this.operations.filter((operation) => operation.method === 'order')
    for (const operation of [...orders].reverse()) {
      const [column, options] = operation.args as [keyof FakeAttempt, { ascending: boolean }]
      output.sort((left, right) => {
        const comparison = String(left[column]).localeCompare(String(right[column]))
        return options.ascending ? comparison : -comparison
      })
    }
    const range = this.operations.find((operation) => operation.method === 'range')
    if (range) output = output.slice(Number(range.args[0]), Number(range.args[1]) + 1)
    const limit = this.operations.find((operation) => operation.method === 'limit')
    if (limit) output = output.slice(0, Number(limit.args[0]))
    return Promise.resolve({ data: output, error: null }).then(onfulfilled, onrejected)
  }
}

function fakeSupabase(rows: FakeAttempt[], failSelect: (select: string) => boolean = () => false) {
  const queries: FakeQuery[] = []
  const client = {
    from: () => {
      const query = new FakeQuery(rows, failSelect)
      queries.push(query)
      return query
    },
  } as unknown as SupabaseClient<Database>
  return { client, queries }
}

describe('history server loading', () => {
  it('distinguishes a successful empty history from a query failure', async () => {
    const empty = fakeSupabase([])
    await expect(
      loadHistoryPage(empty.client, 'user-1', { metadata: 'all', score: 'all', page: 1 }),
    ).resolves.toEqual({
      status: 'ready',
      data: { entries: [], hasAnyEntries: false, hasNext: false, hasPrevious: false },
    })

    const failed = fakeSupabase([attempt(1)], (select) => select.includes('prompt_text'))
    await expect(
      loadHistoryPage(failed.client, 'user-1', { metadata: 'all', score: 'all', page: 1 }),
    ).resolves.toMatchObject({ status: 'failure', operation: 'page' })
  })

  it('filters before pagination so an older matching custom retry remains visible', async () => {
    const rows = Array.from({ length: HISTORY_PAGE_SIZE + 5 }, (_, index) => attempt(index))
    rows.push(
      attempt(99, {
        created_at: '2026-01-01T00:00:00.000Z',
        practice_mode: 'conversation',
        prompt_source: 'custom',
        retry_of_attempt_id: 'attempt-001',
      }),
    )
    const setup = fakeSupabase(rows)

    const custom = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'custom',
      score: 'all',
      page: 1,
    })
    expect(custom).toMatchObject({ status: 'ready' })
    if (custom.status === 'ready')
      expect(custom.data.entries.map((entry) => entry.id)).toEqual(['attempt-099'])

    const retry = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'retry',
      score: 'all',
      page: 1,
    })
    if (retry.status === 'ready')
      expect(retry.data.entries.map((entry) => entry.id)).toEqual(['attempt-099'])
  })

  it('includes legacy, v2, and partial snapshots but excludes unfinished and cross-user rows', async () => {
    const setup = fakeSupabase([
      attempt(1, { score: 61, section_scores: null, practice_mode: null, prompt_source: null }),
      attempt(2, { score: 82, section_scores: { score_version: 'v2' } }),
      attempt(3, { score: null, section_scores: { score_version: 'v2-partial' } }),
      attempt(4, { score: null, section_scores: null }),
      attempt(5, { user_id: 'user-2' }),
    ])

    const result = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'all',
      score: 'all',
      page: 1,
    })
    if (result.status !== 'ready') throw new Error('expected ready history')
    expect(result.data.entries.map((entry) => [entry.id, entry.score])).toEqual([
      ['attempt-003', null],
      ['attempt-002', 82],
      ['attempt-001', 61],
    ])

    const general = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'general',
      score: 'all',
      page: 1,
    })
    if (general.status !== 'ready') throw new Error('expected ready general history')
    expect(general.data.entries.map((entry) => entry.id)).toEqual([
      'attempt-003',
      'attempt-002',
      'attempt-001',
    ])
  })

  it('uses bounded lookahead pages and reports stable pagination', async () => {
    const setup = fakeSupabase(
      Array.from({ length: HISTORY_PAGE_SIZE + 5 }, (_, index) => attempt(index)),
    )
    const first = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'all',
      score: 'all',
      page: 1,
    })
    const second = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'all',
      score: 'all',
      page: 2,
    })
    expect(first).toMatchObject({
      status: 'ready',
      data: { hasNext: true, hasPrevious: false },
    })
    expect(second).toMatchObject({
      status: 'ready',
      data: { hasNext: false, hasPrevious: true },
    })
    const ranges = setup.queries.flatMap((query) =>
      query.operations.filter((operation) => operation.method === 'range'),
    )
    for (const range of ranges) {
      expect(Number(range.args[1]) - Number(range.args[0]) + 1).toBeLessThanOrEqual(
        HISTORY_SCORE_SCAN_SIZE,
      )
    }
  })

  it('keeps combined mode and self-relative score filtering complete', async () => {
    const setup = fakeSupabase([
      attempt(1, { practice_mode: 'interview', score: 40 }),
      attempt(2, { practice_mode: 'interview', score: 80 }),
      attempt(3, { practice_mode: 'conversation', score: 100 }),
    ])
    const result = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'interview',
      score: 'high',
      page: 1,
    })
    if (result.status !== 'ready') throw new Error('expected ready history')
    expect(result.data.entries.map((entry) => entry.score)).toEqual([80])
  })
})
