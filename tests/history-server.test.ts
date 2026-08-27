import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  HISTORY_SCORE_SCAN_SIZE,
  loadHistoryPage,
  safeHistoryErrorCode,
} from '@/lib/results/history-server'
import type { AttemptStatus } from '@/lib/attempts/lifecycle'
import type { Database, Json, PracticeMode, PromptSource } from '@/lib/types/database'
import { legacySectionSnapshot, v2Snapshot } from './helpers/result-snapshots'

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
  status: AttemptStatus
  failure_code: string | null
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
    section_scores: legacySectionSnapshot as unknown as Json,
    practice_mode: 'practice',
    prompt_source: 'library',
    retry_of_attempt_id: null,
    status: 'done',
    failure_code: null,
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

  in(column: string, values: readonly unknown[]): this {
    return this.add('in', column, values)
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
      if (operation.method === 'in')
        output = output.filter((row) =>
          (value as readonly unknown[]).includes(row[column as keyof FakeAttempt]),
        )
      if (operation.method === 'or' && value === undefined) {
        const filters = String(column)
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
  it('keeps diagnostics bounded to a safe code and never logs database messages', () => {
    expect(safeHistoryErrorCode({ code: 'PGRST500', message: 'private database text' })).toBe(
      'PGRST500',
    )
    expect(
      safeHistoryErrorCode({ code: 'bad code', message: 'private database text' }),
    ).toBeUndefined()
    expect(safeHistoryErrorCode(new Error('private database text'))).toBeUndefined()
    const page = readFileSync('src/app/(app)/history/page.tsx', 'utf8')
    expect(page).toContain('safeHistoryErrorCode(historyResult.error)')
    expect(page).not.toContain('error.message')
    expect(page).not.toContain('message: typeof')
  })

  it('distinguishes a successful empty history from a query failure', async () => {
    const empty = fakeSupabase([])
    await expect(
      loadHistoryPage(empty.client, 'user-1', { metadata: 'all', page: 1 }),
    ).resolves.toMatchObject({
      status: 'ready',
      data: {
        entries: [],
        scoreSummary: { cohort: null, points: [], average: null },
        hasAnyEntries: false,
        hasNext: false,
        hasPrevious: false,
      },
    })

    const failed = fakeSupabase(
      [attempt(1)],
      (select) => select === 'id, created_at, score, section_scores, practice_mode',
    )
    await expect(
      loadHistoryPage(failed.client, 'user-1', { metadata: 'all', page: 1 }),
    ).resolves.toMatchObject({ status: 'failure', operation: 'score_cohort' })
  })

  it('filters before pagination so an older matching custom retry remains visible', async () => {
    const rows = Array.from({ length: HISTORY_SCORE_SCAN_SIZE + 5 }, (_, index) => attempt(index))
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
      page: 1,
    })
    expect(custom).toMatchObject({ status: 'ready' })
    if (custom.status === 'ready')
      expect(custom.data.entries.map((entry) => entry.id)).toEqual(['attempt-099'])

    const retry = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'retry',
      page: 1,
    })
    if (retry.status === 'ready')
      expect(retry.data.entries.map((entry) => entry.id)).toEqual(['attempt-099'])
  })

  it('lists terminal rows, excludes active work, and hides stale terminal scores', async () => {
    const setup = fakeSupabase([
      attempt(1, {
        score: 61,
        section_scores: legacySectionSnapshot as unknown as Json,
        practice_mode: null,
        prompt_source: null,
      }),
      attempt(2, {
        score: 82,
        section_scores: v2Snapshot({ component: 0.8 }) as unknown as Json,
      }),
      attempt(3, {
        score: null,
        section_scores: v2Snapshot({ notCheckedCategory: 'grammar' }) as unknown as Json,
      }),
      attempt(4, { status: 'uploading', score: 99 }),
      attempt(5, { status: 'transcribing', section_scores: { stale: true } }),
      attempt(6, { status: 'scoring', score: 98, section_scores: { stale: true } }),
      attempt(7, {
        status: 'failed',
        score: 97,
        section_scores: { stale: true },
        failure_code: 'client_upload_abandoned',
      }),
      attempt(8, {
        status: 'timed_out',
        score: 96,
        section_scores: { stale: true },
        failure_code: 'client_scoring_timeout',
      }),
      attempt(9, { user_id: 'user-2' }),
      attempt(10, { status: 'done', score: null, section_scores: null }),
    ])

    const result = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'all',
      page: 1,
    })
    if (result.status !== 'ready') throw new Error('expected ready history')
    expect(result.data.entries.map((entry) => [entry.id, entry.score, entry.resultKind])).toEqual([
      ['attempt-010', null, 'partial'],
      ['attempt-008', null, undefined],
      ['attempt-007', null, undefined],
      ['attempt-003', null, 'partial'],
      ['attempt-002', 81, 'v2'],
      ['attempt-001', 61, 'legacy'],
    ])
    expect(
      result.data.entries
        .filter((entry) => entry.status !== 'done')
        .map((entry) => [entry.id, entry.status, entry.failureCode]),
    ).toEqual([
      ['attempt-008', 'timed_out', 'client_scoring_timeout'],
      ['attempt-007', 'failed', 'client_upload_abandoned'],
    ])
    expect(result.data.scoreSummary.points.map((point) => point.attemptId)).not.toContain(
      'attempt-007',
    )
    expect(result.data.scoreSummary.points.map((point) => point.attemptId)).not.toContain(
      'attempt-008',
    )

    const general = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'general',
      page: 1,
    })
    if (general.status !== 'ready') throw new Error('expected ready general history')
    expect(general.data.entries.map((entry) => entry.id)).toEqual([
      'attempt-010',
      'attempt-008',
      'attempt-007',
      'attempt-003',
      'attempt-002',
      'attempt-001',
    ])
  })

  it('uses bounded lookahead pages and reports stable pagination', async () => {
    const rows = Array.from({ length: HISTORY_SCORE_SCAN_SIZE + 5 }, (_, index) => attempt(index))
    rows[2] = attempt(2, {
      score: null,
      section_scores: v2Snapshot({ notCheckedCategory: 'grammar' }) as unknown as Json,
    })
    rows[3] = attempt(3, {
      score: 100,
      section_scores: { ...v2Snapshot(), version: 'future.score.1' } as unknown as Json,
    })
    const setup = fakeSupabase(rows)
    const first = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'all',
      page: 1,
    })
    const last = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'all',
      page: 11,
    })
    expect(first).toMatchObject({
      status: 'ready',
      data: { hasNext: true, hasPrevious: false },
    })
    expect(last).toMatchObject({
      status: 'ready',
      data: { hasNext: false, hasPrevious: true },
    })
    if (last.status === 'ready') {
      expect(last.data.entries).toHaveLength(5)
      expect(last.data.entries.map((entry) => entry.id)).toEqual([
        'attempt-004',
        'attempt-003',
        'attempt-002',
        'attempt-001',
        'attempt-000',
      ])
      expect(last.data.entries.map((entry) => entry.resultKind)).toEqual([
        'legacy',
        'unsupported',
        'partial',
        'legacy',
        'legacy',
      ])
    }
    if (first.status === 'ready') {
      expect(first.data.scoreSummary).toMatchObject({
        scannedCount: HISTORY_SCORE_SCAN_SIZE,
        truncated: true,
      })
    }
    const ranges = setup.queries.flatMap((query) =>
      query.operations.filter((operation) => operation.method === 'range'),
    )
    for (const range of ranges) {
      expect(Number(range.args[1]) - Number(range.args[0]) + 1).toBeLessThanOrEqual(
        HISTORY_SCORE_SCAN_SIZE + 1,
      )
    }
  })

  it('keeps metadata filtering complete through database pagination', async () => {
    const setup = fakeSupabase([
      attempt(1, { practice_mode: 'interview', score: 40 }),
      attempt(2, { practice_mode: 'interview', score: 80 }),
      attempt(3, { practice_mode: 'conversation', score: 100 }),
    ])
    const result = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'interview',
      page: 1,
    })
    if (result.status !== 'ready') throw new Error('expected ready history')
    expect(result.data.entries.map((entry) => entry.score)).toEqual([80, 40])
  })

  it('lists mixed generations while filtering and trending one newest exact cohort', async () => {
    const currentLow = v2Snapshot({ component: 0.6 })
    const currentHigh = v2Snapshot({ component: 0.8 })
    const future = { ...v2Snapshot({ component: 1 }), version: 'v3.score.1' }
    const setup = fakeSupabase([
      attempt(1, { score: 55, section_scores: legacySectionSnapshot as unknown as Json }),
      attempt(2, {
        score: 99,
        section_scores: currentLow as unknown as Json,
        created_at: '2026-08-27T00:00:20.000Z',
      }),
      attempt(3, {
        score: 1,
        section_scores: currentHigh as unknown as Json,
        created_at: '2026-08-27T00:00:21.000Z',
      }),
      attempt(4, {
        score: 95,
        section_scores: v2Snapshot({ mode: 'interview', component: 0.95 }) as unknown as Json,
        practice_mode: 'interview',
        created_at: '2026-08-27T00:00:19.000Z',
      }),
      attempt(5, {
        score: 100,
        section_scores: future as unknown as Json,
        created_at: '2026-08-27T00:00:23.000Z',
      }),
      attempt(6, {
        score: 100,
        section_scores: v2Snapshot({ notCheckedCategory: 'grammar' }) as unknown as Json,
        created_at: '2026-08-27T00:00:22.000Z',
      }),
    ])

    const all = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'all',
      page: 1,
    })
    if (all.status !== 'ready') throw new Error('expected ready history')
    expect(all.data.entries.map((entry) => [entry.id, entry.resultKind])).toEqual([
      ['attempt-005', 'unsupported'],
      ['attempt-006', 'partial'],
      ['attempt-003', 'v2'],
      ['attempt-002', 'v2'],
      ['attempt-004', 'v2'],
      ['attempt-001', 'legacy'],
    ])
    expect(all.data.scoreSummary).toMatchObject({
      cohort: { kind: 'v2', mode: 'practice' },
      average: 70.5,
      excludedCount: 4,
    })
    expect(all.data.scoreSummary.points.map((point) => [point.attemptId, point.value])).toEqual([
      ['attempt-002', 60],
      ['attempt-003', 81],
    ])

    const cohortSelect = setup.queries
      .flatMap((query) => query.operations)
      .find(
        (operation) =>
          operation.method === 'select' && String(operation.args[0]).includes('section_scores'),
      )
    expect(cohortSelect?.args[0]).toBe('id, created_at, score, section_scores, practice_mode')
  })

  it('keeps the score cohort strictly done-only when failures contain stale scores', async () => {
    const setup = fakeSupabase([
      attempt(1, { score: 60, section_scores: legacySectionSnapshot as unknown as Json }),
      attempt(2, {
        status: 'failed',
        score: 100,
        section_scores: legacySectionSnapshot as unknown as Json,
        failure_code: 'client_upload_abandoned',
      }),
      attempt(3, {
        status: 'timed_out',
        score: 99,
        section_scores: legacySectionSnapshot as unknown as Json,
        failure_code: 'client_scoring_timeout',
      }),
    ])

    const result = await loadHistoryPage(setup.client, 'user-1', {
      metadata: 'all',
      page: 1,
    })
    if (result.status !== 'ready') throw new Error('expected ready history')
    expect(result.data.entries.map((entry) => [entry.id, entry.score])).toEqual([
      ['attempt-003', null],
      ['attempt-002', null],
      ['attempt-001', 60],
    ])
    expect(result.data.scoreSummary.points.map((point) => point.attemptId)).toEqual(['attempt-001'])
  })
})
