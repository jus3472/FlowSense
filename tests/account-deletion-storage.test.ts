import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  isRecentAccountAuthentication,
  parseResetProgressReceipt,
  prepareOwnedRecordingCleanup,
  removeOwnedRecordings,
} from '@/lib/account/deletion'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const STORAGE_PATH = `${USER_ID}/${ATTEMPT_ID}.webm`

function adminClient(options: {
  attempts?: unknown[]
  attemptError?: unknown
  storagePages?: unknown[][]
  storageError?: unknown
  removeError?: unknown
}) {
  const attemptQuery = {
    select: vi.fn(() => attemptQuery),
    eq: vi.fn(() => attemptQuery),
    order: vi.fn(() => attemptQuery),
    range: vi.fn(async () => ({
      data: options.attempts ?? [],
      error: options.attemptError ?? null,
    })),
  }
  const pages = [...(options.storagePages ?? [[]])]
  const list = vi.fn(async () => ({
    data: pages.shift() ?? [],
    error: options.storageError ?? null,
  }))
  const remove = vi.fn(async (_paths: string[]) => ({
    data: [],
    error: options.removeError ?? null,
  }))
  return {
    client: {
      from: vi.fn(() => attemptQuery),
      storage: { from: vi.fn(() => ({ list, remove })) },
    },
    list,
    remove,
  }
}

beforeEach(() => vi.restoreAllMocks())

describe('owned account recording cleanup', () => {
  it('validates exact recording claims returned by the reset transaction', () => {
    expect(
      parseResetProgressReceipt(
        [
          {
            attempts_deleted: 1,
            lesson_progress_deleted: 1,
            activity_days_deleted: 1,
            recording_claims: [
              {
                id: ATTEMPT_ID,
                audio_path: null,
                metrics: {
                  upload: { storage_path: STORAGE_PATH, mime_type: 'audio/webm;codecs=opus' },
                },
              },
            ],
          },
        ],
        USER_ID,
      ),
    ).toEqual({ attemptsDeleted: 1, recordingPaths: [STORAGE_PATH] })
  })

  it('rejects a reset receipt with a recording claim outside the owner folder', () => {
    expect(
      parseResetProgressReceipt(
        [
          {
            attempts_deleted: 1,
            lesson_progress_deleted: 0,
            activity_days_deleted: 0,
            recording_claims: [
              {
                id: ATTEMPT_ID,
                audio_path: null,
                metrics: {
                  upload: {
                    storage_path: `another-user/${ATTEMPT_ID}.webm`,
                    mime_type: 'audio/webm;codecs=opus',
                  },
                },
              },
            ],
          },
        ],
        USER_ID,
      ),
    ).toBeNull()
  })

  it('combines exact attempt paths with orphan objects inside only the owner folder', async () => {
    const setup = adminClient({
      attempts: [
        {
          id: ATTEMPT_ID,
          audio_path: STORAGE_PATH,
          metrics: {
            upload: { storage_path: STORAGE_PATH, mime_type: 'audio/webm;codecs=opus' },
          },
        },
      ],
      storagePages: [[{ name: `${ATTEMPT_ID}.webm` }, { name: 'orphan.webm' }]],
    })

    await expect(prepareOwnedRecordingCleanup(setup.client as never, USER_ID)).resolves.toEqual({
      status: 'ready',
      paths: [STORAGE_PATH, `${USER_ID}/orphan.webm`],
      attemptCount: 1,
    })
    expect(setup.list).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ limit: 100 }))
  })

  it('fails closed for a stored path that is not the attempt owner path', async () => {
    const setup = adminClient({
      attempts: [
        {
          id: ATTEMPT_ID,
          audio_path: `30000000-0000-4000-8000-000000000003/${ATTEMPT_ID}.webm`,
          metrics: {
            upload: {
              storage_path: `30000000-0000-4000-8000-000000000003/${ATTEMPT_ID}.webm`,
              mime_type: 'audio/webm;codecs=opus',
            },
          },
        },
      ],
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(prepareOwnedRecordingCleanup(setup.client as never, USER_ID)).resolves.toEqual({
      status: 'failure',
      reason: 'invalid_path',
    })
    expect(setup.list).not.toHaveBeenCalled()
  })

  it('finds historical orphan files nested under the exact owner folder', async () => {
    const setup = adminClient({
      storagePages: [
        [{ name: 'older', id: null }],
        [{ name: 'orphan.webm', id: 'storage-object-id' }],
      ],
    })

    await expect(prepareOwnedRecordingCleanup(setup.client as never, USER_ID)).resolves.toEqual({
      status: 'ready',
      paths: [`${USER_ID}/older/orphan.webm`],
      attemptCount: 0,
    })
    expect(setup.list).toHaveBeenNthCalledWith(
      2,
      `${USER_ID}/older`,
      expect.objectContaining({ limit: 100 }),
    )
  })

  it('rejects any removal target outside the exact owner folder', async () => {
    const setup = adminClient({})
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      removeOwnedRecordings(setup.client as never, USER_ID, ['another-user/file.webm']),
    ).resolves.toEqual({ status: 'failure' })
    expect(setup.remove).not.toHaveBeenCalled()
  })

  it('deletes large plans in bounded batches and verifies every target is absent', async () => {
    const setup = adminClient({ storagePages: [[]] })
    const paths = Array.from({ length: 101 }, (_, index) => `${USER_ID}/recording-${index}.webm`)

    await expect(removeOwnedRecordings(setup.client as never, USER_ID, paths)).resolves.toEqual({
      status: 'removed',
      count: 101,
    })
    expect(setup.remove).toHaveBeenCalledTimes(2)
    expect(setup.remove.mock.calls[0]?.[0]).toHaveLength(100)
    expect(setup.remove.mock.calls[1]?.[0]).toHaveLength(1)
    expect(setup.list).toHaveBeenCalled()
  })

  it('fails when Storage reports success but a target remains', async () => {
    const setup = adminClient({
      storagePages: [[{ name: 'recording.webm', id: 'storage-object-id' }]],
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      removeOwnedRecordings(setup.client as never, USER_ID, [`${USER_ID}/recording.webm`]),
    ).resolves.toEqual({ status: 'failure' })
  })

  it('accepts an idempotent remove error only when verification proves absence', async () => {
    const setup = adminClient({ storagePages: [[]], removeError: { code: 'not_found' } })

    await expect(
      removeOwnedRecordings(setup.client as never, USER_ID, [`${USER_ID}/recording.webm`]),
    ).resolves.toEqual({ status: 'removed', count: 1 })
  })

  it('requires an account sign-in within the recent window', () => {
    const now = new Date('2026-09-06T12:00:00.000Z')
    expect(isRecentAccountAuthentication('2026-09-06T11:50:00.000Z', now)).toBe(true)
    expect(isRecentAccountAuthentication('2026-09-06T11:44:59.000Z', now)).toBe(false)
    expect(isRecentAccountAuthentication('not-a-date', now)).toBe(false)
  })
})
