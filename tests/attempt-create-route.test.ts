import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticatedAttemptContext: vi.fn(),
  ensureAttemptCreation: vi.fn(),
}))

vi.mock('@/lib/attempts/server', () => ({
  authenticatedAttemptContext: mocks.authenticatedAttemptContext,
}))
vi.mock('@/lib/attempts/creation-server', () => ({
  ensureAttemptCreation: mocks.ensureAttemptCreation,
}))

import { POST } from '@/app/api/attempts/route'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const REQUEST_ID = '30000000-0000-4000-8000-000000000003'
const PAYLOAD = {
  clientRequestId: REQUEST_ID,
  promptId: null,
  promptText: 'Explain a decision you made recently.',
  mode: 'conversation',
  difficulty: 'beginner',
  source: 'custom',
  targetDurationSeconds: 30,
  retryOfAttemptId: null,
  mimeType: 'audio/webm;codecs=opus',
  durationMs: 12_400,
}

function request() {
  return new Request('http://localhost/api/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(PAYLOAD),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: {} })
})

describe('attempt creation route', () => {
  it('returns the one ensured server row', async () => {
    mocks.ensureAttemptCreation.mockResolvedValue({
      status: 'ready',
      value: {
        attemptId: ATTEMPT_ID,
        storagePath: `${USER_ID}/${ATTEMPT_ID}.webm`,
        status: 'uploading',
        failureCode: null,
        created: true,
      },
    })

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      attemptId: ATTEMPT_ID,
      storagePath: `${USER_ID}/${ATTEMPT_ID}.webm`,
    })
    expect(mocks.ensureAttemptCreation).toHaveBeenCalledWith({
      admin: {},
      userId: USER_ID,
      payload: PAYLOAD,
      intent: 'uploading',
    })
  })

  it('does not resurrect a request key reserved by abandonment', async () => {
    mocks.ensureAttemptCreation.mockResolvedValue({ status: 'abandoned' })

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'That recording request was already closed.',
    })
  })
})
