import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assembleScore: vi.fn(),
  authenticatedAttemptContext: vi.fn(),
  computeMechanical: vi.fn(),
  logAttemptDiagnostic: vi.fn((operation: string, code: string, attemptId: string | null) => {
    console.error({ operation, code, ...(attemptId ? { attemptId } : {}) })
  }),
  markOwnedAttemptFailure: vi.fn(),
  runContentCheckSafely: vi.fn(),
  transitionOwnedAttempt: vi.fn(),
}))

vi.mock('@/lib/attempts/server', () => ({
  authenticatedAttemptContext: mocks.authenticatedAttemptContext,
  logAttemptDiagnostic: mocks.logAttemptDiagnostic,
  markOwnedAttemptFailure: mocks.markOwnedAttemptFailure,
  transitionOwnedAttempt: mocks.transitionOwnedAttempt,
}))

vi.mock('@/lib/env/server', () => ({
  azureSpeechConfig: vi.fn(() => null),
  deepseekApiKey: vi.fn(() => 'fake-api-key-should-never-escape'),
}))

vi.mock('@/lib/scoring/assemble', () => ({
  SCORE_VERSION: 'v1',
  assembleScore: mocks.assembleScore,
}))

vi.mock('@/lib/scoring/mechanical', () => ({
  computeMechanical: mocks.computeMechanical,
}))

vi.mock('@/lib/scoring/run-content', () => ({
  runContentCheckSafely: mocks.runContentCheckSafely,
}))

import { POST } from '@/app/api/score/route'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const PRIVATE_PROMPT = 'Private prompt should never be logged.'
const PRIVATE_TRANSCRIPT = 'Private transcript should never be logged.'
const PRIVATE_PROVIDER_BODY = '<html>fake-provider-secret-should-never-escape</html>'
const GENERIC_ERROR = 'The content provider was unavailable.'
const PROVIDER_DIAGNOSTIC = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  code: 'server_error',
  status: 503,
} as const

function attemptQuery(attempt: Record<string, unknown>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: attempt, error: null })),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

function disputeQuery() {
  const result = Promise.resolve({ data: [], error: null })
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValueOnce(query).mockReturnValueOnce(result)
  return query
}

function legacyAttempt() {
  return {
    id: ATTEMPT_ID,
    prompt_text: PRIVATE_PROMPT,
    audio_path: `${USER_ID}/${ATTEMPT_ID}/recording.webm`,
    transcript: PRIVATE_TRANSCRIPT,
    duration_ms: 20_000,
    metrics: {
      capture: { duration_ms: 20_000, sample_interval_ms: 50, amplitude: [], pitch: [] },
      transcript: { words: [] },
    },
    score: null,
    section_scores: null,
    content_result: null,
    practice_mode: 'practice',
    rubric_version: null,
    status: 'scoring',
    failure_code: null,
    created_at: '2026-08-27T12:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  const attempts = attemptQuery(legacyAttempt())
  const disputes = disputeQuery()
  const admin = {
    from: vi.fn((table: string) => (table === 'attempts' ? attempts : disputes)),
  }
  mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
  mocks.transitionOwnedAttempt.mockResolvedValue(true)
  mocks.computeMechanical.mockReturnValue({
    metrics: {},
    pauses: [],
    warnings: [],
    statistics: { counted_items: [], repeated_phrases: [], word_count: 4 },
  })
  mocks.runContentCheckSafely.mockImplementation(async () => {
    console.warn(PROVIDER_DIAGNOSTIC)
    return {
      model: null,
      parsed: null,
      error: GENERIC_ERROR,
      calls: 1,
      tighten: null,
    }
  })
  mocks.assembleScore.mockReturnValue({
    score: 50,
    section_scores: {
      delivery: { earned: 0 },
      content: { earned: 50 },
    },
    content_result: {
      status: 'not_checked',
      error: GENERIC_ERROR,
      tightened_outcome: 'none',
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('legacy score route provider logging', () => {
  it('keeps one safe provider warning and persists only the generic failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const response = await POST(
      new Request('http://localhost/api/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attemptId: ATTEMPT_ID }),
      }),
    )

    expect(response.status).toBe(200)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(PROVIDER_DIAGNOSTIC)
    expect(error).not.toHaveBeenCalled()
    expect(mocks.logAttemptDiagnostic).not.toHaveBeenCalled()

    expect(mocks.transitionOwnedAttempt).toHaveBeenCalledWith(
      expect.any(Object),
      USER_ID,
      ATTEMPT_ID,
      ['scoring'],
      'done',
      expect.objectContaining({
        content_result: expect.objectContaining({
          status: 'not_checked',
          error: GENERIC_ERROR,
        }),
      }),
    )

    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls, ...info.mock.calls])
    for (const privateValue of [
      PRIVATE_PROVIDER_BODY,
      PRIVATE_PROMPT,
      PRIVATE_TRANSCRIPT,
      'fake-api-key-should-never-escape',
    ]) {
      expect(logged).not.toContain(privateValue)
    }
  })
})
