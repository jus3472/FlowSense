import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticatedAttemptContext: vi.fn(),
  logAttemptDiagnostic: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/attempts/server', () => ({
  authenticatedAttemptContext: mocks.authenticatedAttemptContext,
  logAttemptDiagnostic: mocks.logAttemptDiagnostic,
  markOwnedAttemptFailure: vi.fn(),
  transitionOwnedAttempt: vi.fn(),
}))

import { DELETE } from '@/app/api/attempts/[id]/route'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'

function adminClient(deleteResult: { data: { id: string } | null; error: unknown }) {
  const readQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: { id: ATTEMPT_ID, audio_path: null, metrics: null },
      error: null,
    })),
  }
  readQuery.select.mockReturnValue(readQuery)
  readQuery.eq.mockReturnValue(readQuery)

  const deleteQuery = {
    delete: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async () => deleteResult),
  }
  deleteQuery.delete.mockReturnValue(deleteQuery)
  deleteQuery.eq.mockReturnValue(deleteQuery)
  deleteQuery.select.mockReturnValue(deleteQuery)

  const from = vi.fn().mockReturnValueOnce(readQuery).mockReturnValueOnce(deleteQuery)
  return { admin: { from, storage: { from: vi.fn() } }, deleteQuery }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('attempt deletion cache invalidation', () => {
  it('invalidates every completed-response surface only after a successful row delete', async () => {
    const setup = adminClient({ data: { id: ATTEMPT_ID }, error: null })
    mocks.authenticatedAttemptContext.mockResolvedValue({
      userId: USER_ID,
      admin: setup.admin,
    })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(200)
    expect(setup.deleteQuery.maybeSingle).toHaveBeenCalledOnce()
    expect(mocks.revalidatePath.mock.calls).toEqual([['/home'], ['/history'], ['/progress']])
  })

  it('does not invalidate cached routes when the row deletion fails', async () => {
    const setup = adminClient({ data: null, error: { code: 'DELETE_FAILED' } })
    mocks.authenticatedAttemptContext.mockResolvedValue({
      userId: USER_ID,
      admin: setup.admin,
    })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(500)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
