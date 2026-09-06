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
import { ATTEMPT_FAILURE_CODES } from '@/lib/attempts/lifecycle'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'

function adminClient(
  deleteResult: { data: { id: string } | null; error: unknown },
  attempt: {
    id: string
    audio_path: string | null
    metrics: unknown
    status: string
    failure_code: string | null
  } | null = {
    id: ATTEMPT_ID,
    audio_path: null,
    metrics: null,
    status: 'done',
    failure_code: null,
  },
  storageError: unknown = null,
  claimResult: { data: { id: string } | null; error: unknown } = {
    data: { id: ATTEMPT_ID },
    error: null,
  },
  storageStillExists = storageError !== null,
  deletionReceipt: {
    deleted: boolean
    lesson_id: string | null
    best_attempt_id: string | null
    path_slug: string | null
  } = {
    deleted: true,
    lesson_id: null,
    best_attempt_id: null,
    path_slug: null,
  },
) {
  const readQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: attempt,
      error: null,
    })),
  }
  readQuery.select.mockReturnValue(readQuery)
  readQuery.eq.mockReturnValue(readQuery)

  const claimQuery = {
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async () => claimResult),
  }
  claimQuery.update.mockReturnValue(claimQuery)
  claimQuery.eq.mockReturnValue(claimQuery)
  claimQuery.is.mockReturnValue(claimQuery)
  claimQuery.select.mockReturnValue(claimQuery)

  const needsClaim =
    attempt !== null &&
    (attempt.status === 'failed' || attempt.status === 'timed_out') &&
    attempt.failure_code !== ATTEMPT_FAILURE_CODES.deletionInProgress
  const queries: object[] = [readQuery]
  if (needsClaim) queries.push(claimQuery)
  const from = vi.fn().mockImplementation(() => queries.shift())
  const rpc = vi.fn(async () => ({
    data: deleteResult.data ? [deletionReceipt] : null,
    error: deleteResult.error,
  }))
  const remove = vi.fn(async () => ({ error: storageError }))
  const list = vi.fn(async () => ({
    data: storageStillExists ? [{ name: `${ATTEMPT_ID}.webm` }] : [],
    error: null,
  }))
  const storageFrom = vi.fn(() => ({ list, remove }))
  return {
    admin: { from, rpc, storage: { from: storageFrom } },
    readQuery,
    claimQuery,
    rpc,
    list,
    remove,
  }
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
    expect(setup.rpc).toHaveBeenCalledWith('delete_owned_attempt_and_rebuild', {
      target_user_id: USER_ID,
      target_attempt_id: ATTEMPT_ID,
    })
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/home'],
      ['/history'],
      ['/progress'],
      ['/practice'],
    ])
  })

  it('treats an owned-scope miss as an idempotent delete without touching Storage or data', async () => {
    const setup = adminClient({ data: { id: ATTEMPT_ID }, error: null }, null)
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, redirectTo: '/history' })
    expect(setup.readQuery.eq).toHaveBeenCalledWith('user_id', USER_ID)
    expect(setup.remove).not.toHaveBeenCalled()
    expect(setup.rpc).not.toHaveBeenCalled()
  })

  it('returns the best surviving structured result and revalidates its Track', async () => {
    const setup = adminClient(
      { data: { id: ATTEMPT_ID }, error: null },
      {
        id: ATTEMPT_ID,
        audio_path: null,
        metrics: null,
        status: 'done',
        failure_code: null,
      },
      null,
      { data: { id: ATTEMPT_ID }, error: null },
      false,
      {
        deleted: true,
        lesson_id: 'lesson-1',
        best_attempt_id: 'best-survivor',
        path_slug: 'conversations',
      },
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    await expect(response.json()).resolves.toEqual({
      ok: true,
      redirectTo: '/attempts/best-survivor',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/practice/paths/conversations')
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

  it('removes the validated immutable upload path when audio_path was never finalized', async () => {
    const storagePath = `${USER_ID}/${ATTEMPT_ID}.webm`
    const setup = adminClient(
      { data: { id: ATTEMPT_ID }, error: null },
      {
        id: ATTEMPT_ID,
        audio_path: null,
        status: 'failed',
        failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
        metrics: {
          upload: { storage_path: storagePath, mime_type: 'audio/webm;codecs=opus' },
        },
      },
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(200)
    expect(setup.claimQuery.update).toHaveBeenCalledWith({
      failure_code: ATTEMPT_FAILURE_CODES.deletionInProgress,
    })
    expect(setup.claimQuery.update.mock.invocationCallOrder[0]).toBeLessThan(
      setup.remove.mock.invocationCallOrder[0]!,
    )
    expect(setup.remove).toHaveBeenCalledWith([storagePath])
    expect(setup.remove.mock.invocationCallOrder[0]).toBeLessThan(
      setup.rpc.mock.invocationCallOrder[0]!,
    )
  })

  it('retains the attempt row when immutable-path Storage cleanup fails', async () => {
    const storagePath = `${USER_ID}/${ATTEMPT_ID}.webm`
    const setup = adminClient(
      { data: { id: ATTEMPT_ID }, error: null },
      {
        id: ATTEMPT_ID,
        audio_path: null,
        status: 'failed',
        failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
        metrics: {
          upload: { storage_path: storagePath, mime_type: 'audio/webm;codecs=opus' },
        },
      },
      { code: 'STORAGE_FAILED' },
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(500)
    expect(setup.claimQuery.update).toHaveBeenCalledWith({
      failure_code: ATTEMPT_FAILURE_CODES.deletionInProgress,
    })
    expect(setup.rpc).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('does not delete a capture-only recording through the current runtime path', async () => {
    const storagePath = `${USER_ID}/${ATTEMPT_ID}.webm`
    const setup = adminClient(
      { data: { id: ATTEMPT_ID }, error: null },
      {
        id: ATTEMPT_ID,
        audio_path: storagePath,
        status: 'timed_out',
        failure_code: 'recording_unavailable',
        metrics: { capture: { mime_type: 'audio/webm;codecs=opus' } },
      },
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(409)
    expect(setup.claimQuery.update).not.toHaveBeenCalled()
    expect(setup.remove).not.toHaveBeenCalled()
    expect(setup.rpc).not.toHaveBeenCalled()
  })

  it('fails closed for an invalid immutable upload claim when audio_path is null', async () => {
    const setup = adminClient(
      { data: { id: ATTEMPT_ID }, error: null },
      {
        id: ATTEMPT_ID,
        audio_path: null,
        status: 'failed',
        failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
        metrics: {
          upload: {
            storage_path: `another-user/${ATTEMPT_ID}.webm`,
            mime_type: 'audio/webm;codecs=opus',
          },
        },
      },
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(409)
    expect(setup.remove).not.toHaveBeenCalled()
    expect(setup.rpc).not.toHaveBeenCalled()
  })

  it.each(['uploading', 'transcribing', 'scoring'])(
    'does not delete Storage or the row while an attempt is %s',
    async (status) => {
      const storagePath = `${USER_ID}/${ATTEMPT_ID}.webm`
      const setup = adminClient(
        { data: { id: ATTEMPT_ID }, error: null },
        {
          id: ATTEMPT_ID,
          audio_path: storagePath,
          status,
          failure_code: null,
          metrics: {
            upload: { storage_path: storagePath, mime_type: 'audio/webm;codecs=opus' },
          },
        },
      )
      mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

      const response = await DELETE(new Request('http://localhost'), {
        params: Promise.resolve({ id: ATTEMPT_ID }),
      })

      expect(response.status).toBe(409)
      expect(setup.remove).not.toHaveBeenCalled()
      expect(setup.rpc).not.toHaveBeenCalled()
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    },
  )

  it('does not touch Storage when a retry wins before the deletion claim', async () => {
    const storagePath = `${USER_ID}/${ATTEMPT_ID}.webm`
    const setup = adminClient(
      { data: { id: ATTEMPT_ID }, error: null },
      {
        id: ATTEMPT_ID,
        audio_path: storagePath,
        status: 'failed',
        failure_code: ATTEMPT_FAILURE_CODES.clientTranscriptionFailed,
        metrics: {
          upload: { storage_path: storagePath, mime_type: 'audio/webm;codecs=opus' },
        },
      },
      null,
      { data: null, error: null },
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(409)
    expect(setup.remove).not.toHaveBeenCalled()
    expect(setup.rpc).not.toHaveBeenCalled()
  })

  it('retries cleanup idempotently when an earlier delete left its claim in place', async () => {
    const storagePath = `${USER_ID}/${ATTEMPT_ID}.webm`
    const setup = adminClient(
      { data: { id: ATTEMPT_ID }, error: null },
      {
        id: ATTEMPT_ID,
        audio_path: storagePath,
        status: 'failed',
        failure_code: ATTEMPT_FAILURE_CODES.deletionInProgress,
        metrics: {
          upload: { storage_path: storagePath, mime_type: 'audio/webm;codecs=opus' },
        },
      },
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(200)
    expect(setup.claimQuery.update).not.toHaveBeenCalled()
    expect(setup.remove).toHaveBeenCalledWith([storagePath])
    expect(setup.rpc).toHaveBeenCalledOnce()
  })

  it('finishes deleting a claimed row when Storage reports an already-absent object', async () => {
    const storagePath = `${USER_ID}/${ATTEMPT_ID}.webm`
    const setup = adminClient(
      { data: { id: ATTEMPT_ID }, error: null },
      {
        id: ATTEMPT_ID,
        audio_path: storagePath,
        status: 'failed',
        failure_code: ATTEMPT_FAILURE_CODES.deletionInProgress,
        metrics: {
          upload: { storage_path: storagePath, mime_type: 'audio/webm;codecs=opus' },
        },
      },
      { code: 'OBJECT_NOT_FOUND' },
      { data: { id: ATTEMPT_ID }, error: null },
      false,
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: ATTEMPT_ID }),
    })

    expect(response.status).toBe(200)
    expect(setup.list).toHaveBeenCalledWith(USER_ID, {
      limit: 100,
      search: `${ATTEMPT_ID}.webm`,
    })
    expect(setup.rpc).toHaveBeenCalledOnce()
  })
})
