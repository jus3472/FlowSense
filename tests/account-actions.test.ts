import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearHandoff: vi.fn(),
  markClientState: vi.fn(),
  parseResetReceipt: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  isRecent: vi.fn(() => true),
  logFailure: vi.fn(),
  logCleanupRequired: vi.fn(),
  prepareCleanup: vi.fn(),
  removeRecordings: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw { path }
  }),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/account/deletion', () => ({
  isRecentAccountAuthentication: mocks.isRecent,
  logUserDataDeletionFailure: mocks.logFailure,
  logRecordingCleanupRequired: mocks.logCleanupRequired,
  prepareOwnedRecordingCleanup: mocks.prepareCleanup,
  parseResetProgressReceipt: mocks.parseResetReceipt,
  removeOwnedRecordings: mocks.removeRecordings,
}))
vi.mock('@/lib/practice/custom-handoff-cookie', () => ({
  clearCustomPracticeHandoffCookie: mocks.clearHandoff,
}))
vi.mock('@/lib/auth/account-deletion-cookie', () => ({
  markAccountClientStateForDeletion: mocks.markClientState,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import { deleteAccount, resetProgress } from '@/actions/account'
import { initialDestructiveActionFormState } from '@/lib/forms'

const USER_ID = '10000000-0000-4000-8000-000000000001'

function form(confirmation: string) {
  const data = new FormData()
  data.set('confirmation', confirmation)
  return data
}

function setup() {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({
      data: [{ attempts_deleted: 2, lesson_progress_deleted: 1, activity_days_deleted: 1 }],
      error: null,
    })
  const signOut = vi.fn(async () => ({ error: null }))
  const session = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID, last_sign_in_at: new Date().toISOString() } },
        error: null,
      })),
      signOut,
    },
    rpc,
  }
  const deleteUser = vi.fn(
    async (
      _id: string,
      _shouldSoftDelete: boolean,
    ): Promise<{ data: { user: { id: string } | null }; error: unknown }> => ({
      data: { user: { id: USER_ID } },
      error: null,
    }),
  )
  const admin = { auth: { admin: { deleteUser } } }
  mocks.createClient.mockResolvedValue(session)
  mocks.createAdminClient.mockReturnValue(admin)
  mocks.prepareCleanup.mockResolvedValue({
    status: 'ready',
    paths: [`${USER_ID}/recording.webm`],
    attemptCount: 2,
  })
  mocks.removeRecordings.mockResolvedValue({ status: 'removed', count: 1 })
  return { session, admin, rpc, signOut, deleteUser }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isRecent.mockReturnValue(true)
  mocks.parseResetReceipt.mockReturnValue({ attemptsDeleted: 2, recordingPaths: [] })
})

describe('reset progress action', () => {
  it('enforces typed confirmation before loading a session', async () => {
    await expect(resetProgress(initialDestructiveActionFormState, form('reset'))).resolves.toEqual({
      status: 'error',
      message: 'Type RESET to continue.',
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('uses session identity and the authenticated transactional RPC', async () => {
    const setupResult = setup()

    await expect(resetProgress(initialDestructiveActionFormState, form('RESET'))).resolves.toEqual({
      status: 'success',
      message: 'Your progress was reset.',
    })

    expect(mocks.prepareCleanup).toHaveBeenCalledWith(setupResult.admin, USER_ID)
    expect(setupResult.rpc.mock.calls).toEqual([
      ['assert_my_data_deletion_safe'],
      ['reset_my_progress'],
    ])
    expect(setupResult.signOut).not.toHaveBeenCalled()
    expect(setupResult.deleteUser).not.toHaveBeenCalled()
    expect(mocks.clearHandoff).toHaveBeenCalledOnce()
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/progress')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/practice')
  })

  it('keeps database data unchanged when recording ownership cannot be verified', async () => {
    const setupResult = setup()
    mocks.prepareCleanup.mockResolvedValue({ status: 'failure', reason: 'invalid_path' })

    await expect(
      resetProgress(initialDestructiveActionFormState, form('RESET')),
    ).resolves.toMatchObject({ status: 'error', message: expect.stringContaining('unchanged') })
    expect(setupResult.rpc).toHaveBeenCalledTimes(1)
    expect(setupResult.rpc).not.toHaveBeenCalledWith('reset_my_progress')
  })

  it('reports recoverable recording cleanup after committing and invalidating the reset', async () => {
    setup()
    mocks.removeRecordings.mockResolvedValueOnce({ status: 'failure' })

    await expect(resetProgress(initialDestructiveActionFormState, form('RESET'))).resolves.toEqual({
      status: 'error',
      message:
        'Your progress was reset, but a recording could not be removed. Try Reset progress again.',
    })
    expect(mocks.clearHandoff).toHaveBeenCalledOnce()
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/history')
  })

  it('removes receipt-only paths from attempts that committed after preflight', async () => {
    const setupResult = setup()
    const preflightPath = `${USER_ID}/preflight.webm`
    const latePath = `${USER_ID}/late.webm`
    mocks.prepareCleanup.mockResolvedValueOnce({
      status: 'ready',
      paths: [preflightPath],
      attemptCount: 1,
    })
    mocks.parseResetReceipt.mockReturnValueOnce({
      attemptsDeleted: 2,
      recordingPaths: [latePath],
    })

    await resetProgress(initialDestructiveActionFormState, form('RESET'))

    expect(mocks.removeRecordings).toHaveBeenCalledWith(setupResult.admin, USER_ID, [
      preflightPath,
      latePath,
    ])
  })
})

describe('delete account action', () => {
  it('requires a recent authenticated session before touching data', async () => {
    const setupResult = setup()
    mocks.isRecent.mockReturnValue(false)

    await expect(deleteAccount(initialDestructiveActionFormState, form('DELETE'))).resolves.toEqual(
      {
        status: 'error',
        message: 'Log out and log in again before deleting your account.',
      },
    )
    expect(mocks.prepareCleanup).not.toHaveBeenCalled()
    expect(setupResult.deleteUser).not.toHaveBeenCalled()
  })

  it('deletes only the session user, verifies trailing Storage, and clears the session', async () => {
    const setupResult = setup()

    await expect(
      deleteAccount(initialDestructiveActionFormState, form('DELETE')),
    ).rejects.toMatchObject({ path: '/' })

    expect(setupResult.rpc).toHaveBeenCalledWith('assert_my_data_deletion_safe')
    expect(setupResult.deleteUser).toHaveBeenCalledWith(USER_ID, false)
    expect(mocks.prepareCleanup).toHaveBeenCalledTimes(2)
    expect(setupResult.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(mocks.clearHandoff).toHaveBeenCalledOnce()
    expect(mocks.markClientState).toHaveBeenCalledOnce()
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('keeps the account when Auth deletion fails', async () => {
    const setupResult = setup()
    setupResult.deleteUser.mockResolvedValue({ data: { user: null }, error: { code: 'failed' } })

    await expect(deleteAccount(initialDestructiveActionFormState, form('DELETE'))).resolves.toEqual(
      {
        status: 'error',
        message: 'Your account was not deleted. Some recordings may already be removed. Try again.',
      },
    )
    expect(setupResult.signOut).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('reports a known trailing Storage verification failure after Auth deletion', async () => {
    setup()
    mocks.prepareCleanup
      .mockResolvedValueOnce({ status: 'ready', paths: [], attemptCount: 0 })
      .mockResolvedValueOnce({ status: 'failure', reason: 'storage_list' })

    await expect(
      deleteAccount(initialDestructiveActionFormState, form('DELETE')),
    ).rejects.toMatchObject({ path: '/' })

    expect(mocks.logFailure).toHaveBeenCalledWith('verify_deleted_account_recordings')
    expect(mocks.logCleanupRequired).toHaveBeenCalledWith(USER_ID, [])
  })

  it('retries and reports exact known recording targets after Auth deletion', async () => {
    setup()
    const orphanPath = `${USER_ID}/late-recording.webm`
    mocks.prepareCleanup
      .mockResolvedValueOnce({ status: 'ready', paths: [], attemptCount: 0 })
      .mockResolvedValueOnce({ status: 'ready', paths: [orphanPath], attemptCount: 0 })
    mocks.removeRecordings
      .mockResolvedValueOnce({ status: 'removed', count: 0 })
      .mockResolvedValueOnce({ status: 'failure' })
      .mockResolvedValueOnce({ status: 'failure' })

    await expect(
      deleteAccount(initialDestructiveActionFormState, form('DELETE')),
    ).rejects.toMatchObject({ path: '/' })

    expect(mocks.removeRecordings).toHaveBeenCalledTimes(3)
    expect(mocks.logCleanupRequired).toHaveBeenCalledWith(USER_ID, [orphanPath])
  })
})
