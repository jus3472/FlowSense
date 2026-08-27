import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticatedAttemptContext: vi.fn(),
  transitionOwnedAttemptDetailed: vi.fn(),
}))

vi.mock('@/lib/attempts/server', () => ({
  authenticatedAttemptContext: mocks.authenticatedAttemptContext,
  transitionOwnedAttemptDetailed: mocks.transitionOwnedAttemptDetailed,
}))

import { POST } from '@/app/api/attempts/[id]/failure/route'
import { ATTEMPT_FAILURE_CODES } from '@/lib/attempts/lifecycle'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const admin = { from: vi.fn() }

function request(body: unknown = { expectedStage: 'transcribing', outcome: 'failed' }) {
  return new Request(`http://localhost/api/attempts/${ATTEMPT_ID}/failure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function context(id = ATTEMPT_ID) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
  mocks.transitionOwnedAttemptDetailed.mockResolvedValue('updated')
})

describe('client failure route', () => {
  it('authenticates before accepting a report', async () => {
    mocks.authenticatedAttemptContext.mockResolvedValue(null)

    const response = await POST(request(), context())

    expect(response.status).toBe(401)
    expect(mocks.transitionOwnedAttemptDetailed).not.toHaveBeenCalled()
  })

  it('rejects invalid ids and bounded-report violations', async () => {
    const invalidId = await POST(request(), context('not-an-attempt'))
    const invalidReport = await POST(
      request({ expectedStage: 'uploading', outcome: 'failed' }),
      context(),
    )

    expect(invalidId.status).toBe(404)
    expect(invalidReport.status).toBe(400)
    expect(mocks.transitionOwnedAttemptDetailed).not.toHaveBeenCalled()
  })

  it('maps the report server-side and scopes the stage transition to the owner', async () => {
    const response = await POST(
      request({ expectedStage: 'scoring', outcome: 'timed_out' }),
      context(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, persisted: true })
    expect(mocks.transitionOwnedAttemptDetailed).toHaveBeenCalledExactlyOnceWith(
      admin,
      USER_ID,
      ATTEMPT_ID,
      ['scoring'],
      'timed_out',
      { failure_code: ATTEMPT_FAILURE_CODES.clientScoringTimeout },
    )
  })

  it('treats a stale report after a newer stage or done as a successful no-op', async () => {
    mocks.transitionOwnedAttemptDetailed.mockResolvedValue('stale')

    const response = await POST(request(), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, persisted: false })
    expect(mocks.transitionOwnedAttemptDetailed).toHaveBeenCalledWith(
      admin,
      USER_ID,
      ATTEMPT_ID,
      ['transcribing'],
      'failed',
      { failure_code: ATTEMPT_FAILURE_CODES.clientTranscriptionFailed },
    )
  })

  it('returns a safe server error when the lifecycle update fails', async () => {
    mocks.transitionOwnedAttemptDetailed.mockResolvedValue('failure')

    const response = await POST(request(), context())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'The processing state could not be saved.',
    })
  })
})
