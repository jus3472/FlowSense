import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { ATTEMPT_FAILURE_CODES } from '@/lib/attempts/lifecycle'
import { transitionOwnedAttempt, transitionOwnedAttemptDetailed } from '@/lib/attempts/server'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'

function setup(result: { data: { id: string } | null; error: unknown }) {
  const query = {
    update: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  }
  query.update.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.in.mockReturnValue(query)
  query.or.mockReturnValue(query)
  query.select.mockReturnValue(query)
  return { admin: { from: vi.fn(() => query) }, query }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('owned attempt lifecycle transitions', () => {
  it('atomically excludes a row claimed for deletion', async () => {
    const { admin, query } = setup({ data: null, error: null })

    await expect(
      transitionOwnedAttemptDetailed(
        admin as never,
        USER_ID,
        ATTEMPT_ID,
        ['failed'],
        'transcribing',
      ),
    ).resolves.toBe('stale')

    expect(query.or).toHaveBeenCalledWith(
      `failure_code.is.null,failure_code.neq.${ATTEMPT_FAILURE_CODES.deletionInProgress}`,
    )
  })

  it('distinguishes an updated row from a database failure', async () => {
    const updated = setup({ data: { id: ATTEMPT_ID }, error: null })
    const failed = setup({ data: null, error: { code: 'DATABASE_UNAVAILABLE' } })

    await expect(
      transitionOwnedAttemptDetailed(
        updated.admin as never,
        USER_ID,
        ATTEMPT_ID,
        ['scoring'],
        'done',
      ),
    ).resolves.toBe('updated')
    await expect(
      transitionOwnedAttemptDetailed(
        failed.admin as never,
        USER_ID,
        ATTEMPT_ID,
        ['scoring'],
        'done',
      ),
    ).resolves.toBe('failure')
  })

  it('keeps the compatibility wrapper false for stale and failed updates', async () => {
    const stale = setup({ data: null, error: null })
    const failed = setup({ data: null, error: { code: 'DATABASE_UNAVAILABLE' } })

    await expect(
      transitionOwnedAttempt(
        stale.admin as never,
        USER_ID,
        ATTEMPT_ID,
        ['transcribing'],
        'scoring',
      ),
    ).resolves.toBe(false)
    await expect(
      transitionOwnedAttempt(
        failed.admin as never,
        USER_ID,
        ATTEMPT_ID,
        ['transcribing'],
        'scoring',
      ),
    ).resolves.toBe(false)
  })
})
