import { beforeEach, describe, expect, it, vi } from 'vitest'
import { v3Snapshot } from './helpers/result-snapshots'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { getProgressDashboardData, PROGRESS_QUERY_PAGE_SIZE } from '@/lib/progress/server'

interface Operation {
  method: string
  column?: string
  value?: unknown
  from?: number
  to?: number
}

function attemptRow(id: string) {
  const snapshot = v3Snapshot()
  return {
    id,
    finished_at: '2026-09-04T12:00:00.000Z',
    prompt_text: `Prompt ${id}`,
    retry_of_attempt_id: null,
    score: snapshot.total_earned_points,
    section_scores: snapshot,
    practice_mode: 'practice',
    prompt_source: 'library',
    rubric_version: 'v3',
    status: 'done',
  }
}

function setup(rows: readonly ReturnType<typeof attemptRow>[], failFrom?: number) {
  const operations: Operation[] = []
  const attemptQuery = () => {
    const query = {
      select: vi.fn((_columns: string) => query),
      eq: vi.fn((column: string, value: unknown) => {
        operations.push({ method: 'eq', column, value })
        return query
      }),
      in: vi.fn((column: string, value: unknown) => {
        operations.push({ method: 'in', column, value })
        return query
      }),
      or: vi.fn((value: string) => {
        operations.push({ method: 'or', value })
        return query
      }),
      lte: vi.fn((column: string, value: unknown) => {
        operations.push({ method: 'lte', column, value })
        return query
      }),
      order: vi.fn((column: string, value: unknown) => {
        operations.push({ method: 'order', column, value })
        return query
      }),
      range: vi.fn(async (from: number, to: number) => {
        operations.push({ method: 'range', from, to })
        return from === failFrom
          ? { data: null, error: { code: 'FAKE_PAGE_FAILURE', message: 'private' } }
          : { data: rows.slice(from, to + 1), error: null }
      }),
    }
    return query
  }
  const profileQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { timezone: 'America/Los_Angeles' },
      error: null,
    }),
  }
  const client = {
    from: vi.fn((table: string) => (table === 'profiles' ? profileQuery : attemptQuery())),
  }
  return { client, operations, profileQuery }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('progress server loading', () => {
  it('loads full paginated history in finished-at and id order with local timezone', async () => {
    const rows = Array.from({ length: PROGRESS_QUERY_PAGE_SIZE + 1 }, (_, index) =>
      attemptRow(`attempt-${String(index).padStart(3, '0')}`),
    )
    const fake = setup(rows)
    mocks.createClient.mockResolvedValue(fake.client)

    const result = await getProgressDashboardData('user-1', {
      now: new Date('2026-09-05T12:00:00.000Z'),
      filter: 'all',
    })

    expect(result).toMatchObject({
      status: 'ready',
      data: {
        timezone: 'America/Los_Angeles',
        progress: { counts: { included: PROGRESS_QUERY_PAGE_SIZE + 1 } },
      },
    })
    expect(fake.operations.filter(({ method }) => method === 'range')).toEqual([
      { method: 'range', from: 0, to: PROGRESS_QUERY_PAGE_SIZE - 1 },
      {
        method: 'range',
        from: PROGRESS_QUERY_PAGE_SIZE,
        to: PROGRESS_QUERY_PAGE_SIZE * 2 - 1,
      },
    ])
    expect(fake.operations).toContainEqual({
      method: 'order',
      column: 'finished_at',
      value: { ascending: true },
    })
    expect(fake.operations).toContainEqual({
      method: 'order',
      column: 'id',
      value: { ascending: true },
    })
    expect(fake.profileQuery.select).toHaveBeenCalledWith('timezone')
  })

  it('applies the selected canonical mode before paging', async () => {
    const fake = setup([attemptRow('attempt')])
    mocks.createClient.mockResolvedValue(fake.client)

    const result = await getProgressDashboardData('user-1', {
      now: new Date('2026-09-05T12:00:00.000Z'),
      filter: 'practice',
    })
    expect(result.status).toBe('ready')

    expect(fake.operations).toContainEqual({ method: 'eq', column: 'user_id', value: 'user-1' })
    expect(fake.operations).toContainEqual({ method: 'eq', column: 'status', value: 'done' })
    expect(fake.operations).toContainEqual({ method: 'eq', column: 'rubric_version', value: 'v3' })
    expect(fake.operations).toContainEqual({
      method: 'eq',
      column: 'practice_mode',
      value: 'practice',
    })
    expect(fake.operations).toContainEqual({
      method: 'in',
      column: 'prompt_source',
      value: ['library', 'custom'],
    })
  })

  it('fails the whole load when a later page fails without logging provider text', async () => {
    const rows = Array.from({ length: PROGRESS_QUERY_PAGE_SIZE }, (_, index) =>
      attemptRow(`attempt-${index}`),
    )
    const fake = setup(rows, PROGRESS_QUERY_PAGE_SIZE)
    mocks.createClient.mockResolvedValue(fake.client)
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await getProgressDashboardData('user-1', {
      now: new Date('2026-09-05T12:00:00.000Z'),
      filter: 'all',
    })

    expect(result).toEqual({ status: 'failure', reason: 'query' })
    expect(logging).toHaveBeenCalledWith('[progress] attempt load failed', {
      reason: 'query',
      code: 'FAKE_PAGE_FAILURE',
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain('private')
    logging.mockRestore()
  })

  it('falls back to UTC when the stored timezone is invalid', async () => {
    const fake = setup([])
    fake.profileQuery.maybeSingle.mockResolvedValueOnce({
      data: { timezone: 'Mars/Olympus' },
      error: null,
    })
    mocks.createClient.mockResolvedValue(fake.client)

    const result = await getProgressDashboardData('user-1', {
      now: new Date('2026-09-05T12:00:00.000Z'),
      filter: 'all',
    })

    expect(result).toMatchObject({ status: 'ready', data: { timezone: 'UTC' } })
  })
})
