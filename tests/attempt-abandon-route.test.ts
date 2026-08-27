import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticatedAttemptContext: vi.fn(),
  ensureAttemptCreation: vi.fn(),
  abandonEnsuredAttempt: vi.fn(),
}))

vi.mock('@/lib/attempts/server', () => ({
  authenticatedAttemptContext: mocks.authenticatedAttemptContext,
}))
vi.mock('@/lib/attempts/creation-server', () => ({
  ensureAttemptCreation: mocks.ensureAttemptCreation,
  abandonEnsuredAttempt: mocks.abandonEnsuredAttempt,
}))

import { POST } from '@/app/api/attempts/abandon/route'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const REQUEST_ID = '30000000-0000-4000-8000-000000000003'
const STORAGE_PATH = `${USER_ID}/${ATTEMPT_ID}.webm`
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

function request(body: unknown) {
  return new Request('http://localhost/api/attempts/abandon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('attempt abandonment route', () => {
  it('authenticates before doing any reconciliation', async () => {
    mocks.authenticatedAttemptContext.mockResolvedValue(null)

    const response = await POST(request(PAYLOAD))

    expect(response.status).toBe(401)
    expect(mocks.ensureAttemptCreation).not.toHaveBeenCalled()
  })

  it('passes the full bounded creation input and optional server attempt id', async () => {
    const admin = { from: vi.fn(), storage: { from: vi.fn() } }
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    const value = {
      attemptId: ATTEMPT_ID,
      storagePath: STORAGE_PATH,
      status: 'uploading',
      failureCode: null,
      created: false,
    }
    mocks.ensureAttemptCreation.mockResolvedValue({ status: 'ready', value })
    mocks.abandonEnsuredAttempt.mockResolvedValue({ status: 'ready', abandoned: true })

    const response = await POST(request({ ...PAYLOAD, attemptId: ATTEMPT_ID }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      attemptId: ATTEMPT_ID,
      abandoned: true,
    })
    expect(mocks.ensureAttemptCreation).toHaveBeenCalledWith({
      admin,
      userId: USER_ID,
      payload: PAYLOAD,
      intent: 'abandoned',
      expectedAttemptId: ATTEMPT_ID,
    })
    expect(mocks.abandonEnsuredAttempt).toHaveBeenCalledWith(admin, USER_ID, value)
  })

  it('rejects malformed ids and mismatched request snapshots', async () => {
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: {} })

    const malformed = await POST(request({ ...PAYLOAD, attemptId: 'not-an-id' }))
    expect(malformed.status).toBe(400)
    expect(mocks.ensureAttemptCreation).not.toHaveBeenCalled()

    mocks.ensureAttemptCreation.mockResolvedValue({ status: 'conflict' })
    const conflict = await POST(request({ ...PAYLOAD, attemptId: ATTEMPT_ID }))
    expect(conflict.status).toBe(409)
    expect(mocks.abandonEnsuredAttempt).not.toHaveBeenCalled()
  })

  it('contains no attempt-row or Storage deletion path', () => {
    const source = readFileSync('src/app/api/attempts/abandon/route.ts', 'utf8')

    expect(source).not.toContain('.delete(')
    expect(source).not.toContain('.remove(')
    expect(source).not.toContain('.storage')
  })
})
