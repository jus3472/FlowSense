import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticatedAttemptContext: vi.fn(),
  logAttemptDiagnostic: vi.fn(),
  markOwnedAttemptFailure: vi.fn(),
  transitionOwnedAttempt: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/attempts/server', () => ({
  authenticatedAttemptContext: mocks.authenticatedAttemptContext,
  logAttemptDiagnostic: mocks.logAttemptDiagnostic,
  markOwnedAttemptFailure: mocks.markOwnedAttemptFailure,
  transitionOwnedAttempt: mocks.transitionOwnedAttempt,
}))

import { PATCH } from '@/app/api/attempts/[id]/route'
import { ATTEMPT_FAILURE_CODES } from '@/lib/attempts/lifecycle'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const STORAGE_PATH = `${USER_ID}/${ATTEMPT_ID}.webm`

const CAPTURE = {
  mime_type: 'audio/webm;codecs=opus',
  started_at: '2026-08-27T12:00:00.000Z',
  duration_ms: 12_400,
  sample_interval_ms: 50,
  amplitude: [{ t_ms: 0, rms: 0.02 }],
  pitch: [{ t_ms: 50, hz: 132.4 }],
}

function request() {
  return new Request(`http://localhost/api/attempts/${ATTEMPT_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioPath: STORAGE_PATH, capture: CAPTURE }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('abandoned upload finalization', () => {
  it('cannot resurrect a client_upload_abandoned tombstone', async () => {
    const read = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: ATTEMPT_ID,
          audio_path: STORAGE_PATH,
          duration_ms: CAPTURE.duration_ms,
          metrics: {
            upload: { storage_path: STORAGE_PATH, mime_type: CAPTURE.mime_type },
          },
          status: 'failed',
          failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
        },
        error: null,
      })),
    }
    read.select.mockReturnValue(read)
    read.eq.mockReturnValue(read)
    const storageFrom = vi.fn()
    mocks.authenticatedAttemptContext.mockResolvedValue({
      userId: USER_ID,
      admin: { from: vi.fn(() => read), storage: { from: storageFrom } },
    })

    const response = await PATCH(request(), { params: Promise.resolve({ id: ATTEMPT_ID }) })

    expect(response.status).toBe(409)
    expect(storageFrom).not.toHaveBeenCalled()
    expect(mocks.markOwnedAttemptFailure).not.toHaveBeenCalled()
    expect(mocks.transitionOwnedAttempt).not.toHaveBeenCalled()
  })
})
