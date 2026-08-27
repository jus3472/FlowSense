import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROGRESS_COMPLETED_ATTEMPT_LIMIT, getProgressDashboardData } from '@/lib/progress/server'
import { v2Snapshot } from './helpers/result-snapshots'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

interface ProgressRow {
  id: string
  user_id: string
  created_at: string
  section_scores: unknown
  retry_of_attempt_id: string | null
  status: string
}

interface Operation {
  method: string
  args: unknown[]
}

class FakeProgressQuery implements PromiseLike<{
  data: ProgressRow[] | null
  error: { code: string } | null
}> {
  readonly operations: Operation[] = []

  constructor(
    private readonly rows: readonly ProgressRow[],
    private readonly error: { code: string } | null = null,
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

  order(column: string, options: { ascending: boolean }): this {
    return this.add('order', column, options)
  }

  limit(value: number): this {
    return this.add('limit', value)
  }

  then<TResult1 = { data: ProgressRow[] | null; error: { code: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: ProgressRow[] | null
          error: { code: string } | null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.error) return Promise.resolve({ data: null, error: this.error }).then(onfulfilled)

    let output = [...this.rows]
    for (const operation of this.operations) {
      if (operation.method !== 'eq') continue
      const [column, value] = operation.args
      output = output.filter((row) => row[column as keyof ProgressRow] === value)
    }
    const orders = this.operations.filter((operation) => operation.method === 'order')
    for (const operation of [...orders].reverse()) {
      const [column, options] = operation.args as [keyof ProgressRow, { ascending: boolean }]
      output.sort((left, right) => {
        const comparison = String(left[column]).localeCompare(String(right[column]))
        return options.ascending ? comparison : -comparison
      })
    }
    const limit = this.operations.find((operation) => operation.method === 'limit')
    if (limit) output = output.slice(0, Number(limit.args[0]))
    return Promise.resolve({ data: output, error: null }).then(onfulfilled, onrejected)
  }
}

function row(id: string, over: Partial<ProgressRow> = {}): ProgressRow {
  return {
    id,
    user_id: 'user-1',
    created_at: '2026-08-25T12:00:00.000Z',
    section_scores: v2Snapshot(),
    retry_of_attempt_id: null,
    status: 'done',
    ...over,
  }
}

function useQuery(rows: readonly ProgressRow[], error: { code: string } | null = null) {
  const query = new FakeProgressQuery(rows, error)
  const from = vi.fn(() => query)
  mocks.createClient.mockResolvedValue({ from })
  return { from, query }
}

beforeEach(() => {
  mocks.createClient.mockReset()
  vi.restoreAllMocks()
})

describe('progress server query window', () => {
  it('uses one stable bounded query and discloses truncation', async () => {
    const attempts = Array.from({ length: PROGRESS_COMPLETED_ATTEMPT_LIMIT + 2 }, (_, index) =>
      row(`attempt-${String(index).padStart(3, '0')}`),
    )
    attempts.push(row('other-user', { user_id: 'user-2' }))
    attempts.push(row('not-done', { status: 'failed' }))
    const setup = useQuery(attempts)

    const result = await getProgressDashboardData('user-1', {
      now: new Date('2026-08-26T12:00:00.000Z'),
    })

    expect(setup.from).toHaveBeenCalledOnce()
    expect(setup.query.operations).toEqual([
      {
        method: 'select',
        args: ['id, created_at, section_scores, retry_of_attempt_id, status'],
      },
      { method: 'eq', args: ['user_id', 'user-1'] },
      { method: 'eq', args: ['status', 'done'] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'order', args: ['id', { ascending: false }] },
      { method: 'limit', args: [PROGRESS_COMPLETED_ATTEMPT_LIMIT + 1] },
    ])
    expect(result).toMatchObject({
      status: 'ready',
      data: {
        coverage: {
          completedAttemptLimit: PROGRESS_COMPLETED_ATTEMPT_LIMIT,
          truncated: true,
        },
        progress: { counts: { input: PROGRESS_COMPLETED_ATTEMPT_LIMIT } },
      },
    })
    if (result.status === 'ready') {
      expect(result.data.progress.windows.all.overall.points.at(0)?.attemptId).toBe('attempt-002')
      expect(result.data.progress.windows.all.overall.points.at(-1)?.attemptId).toBe('attempt-201')
    }
  })

  it('preserves a successful empty state without a truncation claim', async () => {
    useQuery([])

    await expect(
      getProgressDashboardData('user-1', { now: new Date('2026-08-26T12:00:00.000Z') }),
    ).resolves.toMatchObject({
      status: 'ready',
      data: {
        coverage: { truncated: false },
        progress: { counts: { input: 0, selectedCohort: 0 } },
      },
    })
  })

  it('keeps query errors distinct from empty data', async () => {
    useQuery([], { code: 'QUERY_FAILED' })
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      getProgressDashboardData('user-1', { now: new Date('2026-08-26T12:00:00.000Z') }),
    ).resolves.toEqual({ status: 'failure', reason: 'query' })
    expect(logging).toHaveBeenCalledWith('[progress] attempt load failed', {
      reason: 'query',
      code: 'QUERY_FAILED',
    })
  })
})
