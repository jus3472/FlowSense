import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  logAttemptDiagnostic: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/attempts/server', () => ({ logAttemptDiagnostic: mocks.logAttemptDiagnostic }))

import {
  reconcileCurrentUserStaleAttempts,
  reconcileOwnedStaleAttempts,
  STALE_ACTIVE_ATTEMPT_AGE_MS,
} from '@/lib/attempts/reconciliation'
import { ATTEMPT_FAILURE_CODES, type AttemptStatus } from '@/lib/attempts/lifecycle'

const NOW = new Date('2026-08-27T12:00:00.000Z')
const USER_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '20000000-0000-4000-8000-000000000002'

interface FakeAttempt {
  id: string
  user_id: string
  status: AttemptStatus
  status_changed_at: string
  finished_at: string | null
  failure_code: string | null
  audio_path: string | null
  transcript: string | null
  metrics: Record<string, unknown>
  section_scores: Record<string, unknown> | null
}

interface QueryOperation {
  method: string
  column?: string
  value?: unknown
}

function attempt(
  id: string,
  status: AttemptStatus,
  statusChangedAt: string,
  overrides: Partial<FakeAttempt> = {},
): FakeAttempt {
  return {
    id,
    user_id: USER_ID,
    status,
    status_changed_at: statusChangedAt,
    finished_at:
      status === 'done' || status === 'failed' || status === 'timed_out' ? NOW.toISOString() : null,
    failure_code: null,
    audio_path: `${USER_ID}/${id}.webm`,
    transcript: 'Stored transcript evidence.',
    metrics: { capture: { duration_ms: 12_000 }, evidence: ['stored'] },
    section_scores: { version: 'v2.score.1', evidence: ['stored'] },
    ...overrides,
  }
}

class FakeUpdateQuery implements PromiseLike<{
  data: Array<{ id: string }> | null
  error: unknown
}> {
  readonly operations: QueryOperation[] = []
  private values: Partial<FakeAttempt> = {}

  constructor(
    private readonly rows: FakeAttempt[],
    private readonly failStage: AttemptStatus | null,
  ) {}

  update(values: Partial<FakeAttempt>): this {
    this.values = values
    this.operations.push({ method: 'update', value: values })
    return this
  }

  eq(column: string, value: unknown): this {
    this.operations.push({ method: 'eq', column, value })
    return this
  }

  lt(column: string, value: unknown): this {
    this.operations.push({ method: 'lt', column, value })
    return this
  }

  is(column: string, value: unknown): this {
    this.operations.push({ method: 'is', column, value })
    return this
  }

  select(_columns: string): this {
    this.operations.push({ method: 'select' })
    return this
  }

  private matches(row: FakeAttempt): boolean {
    return this.operations.every((operation) => {
      if (!operation.column) return true
      const value = row[operation.column as keyof FakeAttempt]
      if (operation.method === 'eq') return value === operation.value
      if (operation.method === 'lt') return String(value) < String(operation.value)
      if (operation.method === 'is') return value === operation.value
      return true
    })
  }

  private execute(): { data: Array<{ id: string }> | null; error: unknown } {
    const expectedStage = this.operations.find(
      (operation) => operation.method === 'eq' && operation.column === 'status',
    )?.value
    if (expectedStage === this.failStage) {
      return { data: null, error: { code: 'DATABASE_UNAVAILABLE' } }
    }

    const matches = this.rows.filter((row) => this.matches(row))
    for (const row of matches) {
      Object.assign(row, this.values)
      row.status_changed_at = NOW.toISOString()
      row.finished_at = NOW.toISOString()
    }
    return { data: matches.map((row) => ({ id: row.id })), error: null }
  }

  then<TResult1 = { data: Array<{ id: string }> | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: Array<{ id: string }> | null
          error: unknown
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }
}

function fakeAdmin(rows: FakeAttempt[], failStage: AttemptStatus | null = null) {
  const queries: FakeUpdateQuery[] = []
  const admin = {
    from: vi.fn((table: string) => {
      expect(table).toBe('attempts')
      const query = new FakeUpdateQuery(rows, failStage)
      queries.push(query)
      return query
    }),
  }
  return { admin, queries }
}

function isoBefore(milliseconds: number, extraMilliseconds = 1): string {
  return new Date(NOW.getTime() - milliseconds - extraMilliseconds).toISOString()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('stale active attempt reconciliation', () => {
  it('closes a stale uploading attempt without removing its stored upload evidence', async () => {
    const row = attempt(
      'uploading-stale',
      'uploading',
      isoBefore(STALE_ACTIVE_ATTEMPT_AGE_MS.uploading),
    )
    const evidence = { audioPath: row.audio_path, metrics: row.metrics }
    const setup = fakeAdmin([row])

    const result = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, { now: NOW })

    expect(result).toMatchObject({
      status: 'ready',
      reconciled: [
        {
          id: row.id,
          previousStatus: 'uploading',
          status: 'failed',
          failureCode: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
        },
      ],
    })
    expect(row).toMatchObject({
      status: 'failed',
      failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
      finished_at: NOW.toISOString(),
      audio_path: evidence.audioPath,
      metrics: evidence.metrics,
    })
  })

  it('times out a stale transcribing attempt and preserves transcript evidence', async () => {
    const row = attempt(
      'transcribing-stale',
      'transcribing',
      isoBefore(STALE_ACTIVE_ATTEMPT_AGE_MS.transcribing),
    )
    const setup = fakeAdmin([row])

    const result = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, { now: NOW })

    expect(result.reconciled).toContainEqual({
      id: row.id,
      previousStatus: 'transcribing',
      status: 'timed_out',
      failureCode: ATTEMPT_FAILURE_CODES.clientTranscriptionTimeout,
    })
    expect(row).toMatchObject({
      status: 'timed_out',
      failure_code: ATTEMPT_FAILURE_CODES.clientTranscriptionTimeout,
      transcript: 'Stored transcript evidence.',
    })
  })

  it('times out a stale scoring attempt and preserves stored scoring evidence', async () => {
    const row = attempt('scoring-stale', 'scoring', isoBefore(STALE_ACTIVE_ATTEMPT_AGE_MS.scoring))
    const sectionScores = row.section_scores
    const setup = fakeAdmin([row])

    const result = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, { now: NOW })

    expect(result.reconciled).toContainEqual({
      id: row.id,
      previousStatus: 'scoring',
      status: 'timed_out',
      failureCode: ATTEMPT_FAILURE_CODES.clientScoringTimeout,
    })
    expect(row).toMatchObject({
      status: 'timed_out',
      failure_code: ATTEMPT_FAILURE_CODES.clientScoringTimeout,
      section_scores: sectionScores,
    })
  })

  it('does not touch fresh active attempts or rows exactly at the cutoff', async () => {
    const rows = [
      attempt(
        'uploading-fresh',
        'uploading',
        new Date(NOW.getTime() - STALE_ACTIVE_ATTEMPT_AGE_MS.uploading + 1).toISOString(),
      ),
      attempt(
        'transcribing-cutoff',
        'transcribing',
        new Date(NOW.getTime() - STALE_ACTIVE_ATTEMPT_AGE_MS.transcribing).toISOString(),
      ),
      attempt(
        'scoring-fresh',
        'scoring',
        new Date(NOW.getTime() - STALE_ACTIVE_ATTEMPT_AGE_MS.scoring + 1).toISOString(),
      ),
    ]
    const setup = fakeAdmin(rows)

    const result = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, { now: NOW })

    expect(result).toEqual({ status: 'ready', reconciled: [] })
    expect(rows.map((row) => row.status)).toEqual(['uploading', 'transcribing', 'scoring'])
  })

  it('never overwrites terminal or abandoned attempts', async () => {
    const rows = [
      attempt('done', 'done', '2026-01-01T00:00:00.000Z'),
      attempt('failed', 'failed', '2026-01-01T00:00:00.000Z', {
        failure_code: ATTEMPT_FAILURE_CODES.scoringUnexpected,
      }),
      attempt('timed-out', 'timed_out', '2026-01-01T00:00:00.000Z', {
        failure_code: ATTEMPT_FAILURE_CODES.transcriptionTimeout,
      }),
      attempt('abandoned', 'failed', '2026-01-01T00:00:00.000Z', {
        failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
      }),
    ]
    const statuses = rows.map((row) => [row.status, row.failure_code])
    const setup = fakeAdmin(rows)

    const result = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, { now: NOW })

    expect(result).toEqual({ status: 'ready', reconciled: [] })
    expect(rows.map((row) => [row.status, row.failure_code])).toEqual(statuses)
  })

  it('is idempotent when reconciliation is repeated', async () => {
    const row = attempt(
      'stale-once',
      'transcribing',
      isoBefore(STALE_ACTIVE_ATTEMPT_AGE_MS.transcribing),
    )
    const setup = fakeAdmin([row])

    const first = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, { now: NOW })
    const finishedAt = row.finished_at
    const second = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, { now: NOW })

    expect(first.reconciled).toHaveLength(1)
    expect(second).toEqual({ status: 'ready', reconciled: [] })
    expect(row.finished_at).toBe(finishedAt)
  })

  it("cannot reconcile another user's stale attempt", async () => {
    const owned = attempt('owned', 'scoring', isoBefore(STALE_ACTIVE_ATTEMPT_AGE_MS.scoring))
    const other = attempt('other', 'scoring', isoBefore(STALE_ACTIVE_ATTEMPT_AGE_MS.scoring), {
      user_id: OTHER_USER_ID,
    })
    const setup = fakeAdmin([owned, other])

    const result = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, { now: NOW })

    expect(result.reconciled.map((entry) => entry.id)).toEqual([owned.id])
    expect(other.status).toBe('scoring')
    for (const query of setup.queries) {
      expect(query.operations).toContainEqual({ method: 'eq', column: 'user_id', value: USER_ID })
    }
  })

  it('can restrict reconciliation to the exact attempt in a result or retry URL', async () => {
    const rows = [
      attempt('requested', 'scoring', isoBefore(STALE_ACTIVE_ATTEMPT_AGE_MS.scoring)),
      attempt('unrelated', 'scoring', isoBefore(STALE_ACTIVE_ATTEMPT_AGE_MS.scoring)),
    ]
    const setup = fakeAdmin(rows)

    const result = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, {
      now: NOW,
      attemptId: 'requested',
    })

    expect(result.reconciled.map((entry) => entry.id)).toEqual(['requested'])
    expect(rows[1]?.status).toBe('scoring')
  })

  it('fails open with a bounded diagnostic when one database update fails', async () => {
    const row = attempt(
      'stale-error',
      'transcribing',
      isoBefore(STALE_ACTIVE_ATTEMPT_AGE_MS.transcribing),
    )
    const setup = fakeAdmin([row], 'transcribing')

    const result = await reconcileOwnedStaleAttempts(setup.admin as never, USER_ID, { now: NOW })

    expect(result).toEqual({ status: 'failure', reconciled: [] })
    expect(row.status).toBe('transcribing')
    expect(mocks.logAttemptDiagnostic).toHaveBeenCalledWith(
      'reconcile_stale_attempt',
      'stale_transcribing_reconciliation_failed',
      null,
      { code: 'DATABASE_UNAVAILABLE' },
    )
  })

  it('fails open when the server admin client is unavailable', async () => {
    const error = Object.assign(new Error('private server configuration'), {
      code: 'ADMIN_UNAVAILABLE',
    })
    mocks.createAdminClient.mockImplementationOnce(() => {
      throw error
    })

    await expect(
      reconcileCurrentUserStaleAttempts(USER_ID, { attemptId: 'requested' }),
    ).resolves.toEqual({ status: 'failure', reconciled: [] })
    expect(mocks.logAttemptDiagnostic).toHaveBeenCalledWith(
      'reconcile_stale_attempt',
      'stale_attempt_client_failed',
      'requested',
      error,
    )
  })
})
