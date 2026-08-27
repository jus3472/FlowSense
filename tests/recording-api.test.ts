import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/net/fetch-with-timeout', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/net/fetch-with-timeout')>()
  return { ...original, fetchWithTimeout: mocks.fetchWithTimeout }
})

vi.mock('@/lib/env/public', () => ({
  publicEnv: { supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'test-key' },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: mocks.getSession } }),
}))

import {
  abandonUploadingAttempt,
  persistAttemptFailure,
  scoreAttempt,
  transcribeAttempt,
  uploadAudio,
  type CreateAttemptInput,
} from '@/lib/recording/api'
import {
  AUTH_SESSION_TIMEOUT_MS,
  CLIENT_FAILURE_REPORT_TIMEOUT_MS,
  SCORING_REQUEST_TIMEOUT_MS,
  TRANSCRIPTION_PROVIDER_TIMEOUT_MS,
  TRANSCRIPTION_REQUEST_TIMEOUT_MS,
} from '@/lib/recording/timeouts'

const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const REQUEST_ID = '30000000-0000-4000-8000-000000000003'
const CREATE_INPUT: CreateAttemptInput = {
  promptId: '10000000-0000-4000-8000-000000000001',
  promptText: 'Describe a decision you made.',
  mode: 'practice',
  source: 'library',
  difficulty: 'beginner',
  targetDurationSeconds: 60,
  retryOfAttemptId: null,
  clientRequestId: REQUEST_ID,
  durationMs: 12_000,
  mimeType: 'audio/webm;codecs=opus',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
  mocks.fetchWithTimeout.mockImplementation(async () =>
    Response.json({ ok: true, wordCount: 12, score: 84 }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('recording request boundaries', () => {
  it('gives transcription and scoring meaningful server response headroom', () => {
    expect(TRANSCRIPTION_REQUEST_TIMEOUT_MS).toBeGreaterThan(TRANSCRIPTION_PROVIDER_TIMEOUT_MS)
    expect(SCORING_REQUEST_TIMEOUT_MS).toBeGreaterThan(60_000)
  })

  it('applies operation-specific timeouts without adding operation tokens', async () => {
    const controller = new AbortController()

    await transcribeAttempt(ATTEMPT_ID, controller.signal)
    await scoreAttempt(ATTEMPT_ID, controller.signal)

    expect(mocks.fetchWithTimeout).toHaveBeenNthCalledWith(
      1,
      '/api/transcribe',
      expect.objectContaining({
        signal: controller.signal,
        body: JSON.stringify({ attemptId: ATTEMPT_ID }),
      }),
      { label: 'Transcribing your answer', timeoutMs: TRANSCRIPTION_REQUEST_TIMEOUT_MS },
    )
    expect(mocks.fetchWithTimeout).toHaveBeenNthCalledWith(
      2,
      '/api/score',
      expect.objectContaining({
        signal: controller.signal,
        body: JSON.stringify({ attemptId: ATTEMPT_ID }),
      }),
      { label: 'Scoring your answer', timeoutMs: SCORING_REQUEST_TIMEOUT_MS },
    )
  })

  it('times out a never-resolving session lookup before starting the upload fetch', async () => {
    vi.useFakeTimers()
    mocks.getSession.mockReturnValue(new Promise(() => undefined))

    const pending = uploadAudio(new Blob(['audio']), 'owned/attempt.webm', CREATE_INPUT.mimeType)
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'RequestTimeoutError',
      timeoutMs: AUTH_SESSION_TIMEOUT_MS,
    })
    await vi.advanceTimersByTimeAsync(AUTH_SESSION_TIMEOUT_MS)

    await rejection
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled()
  })

  it('honors cancellation during session lookup and ignores its late token', async () => {
    const controller = new AbortController()
    let resolveSession:
      ((value: { data: { session: { access_token: string } } }) => void) | undefined
    mocks.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve
      }),
    )
    const pending = uploadAudio(
      new Blob(['audio']),
      'owned/attempt.webm',
      CREATE_INPUT.mimeType,
      controller.signal,
    )

    controller.abort(new DOMException('Navigation', 'AbortError'))
    resolveSession?.({ data: { session: { access_token: 'late-token' } } })

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled()
  })

  it('reports only the tokenless bounded stage and outcome', async () => {
    const controller = new AbortController()

    await persistAttemptFailure(ATTEMPT_ID, 'transcribing', 'failed', controller.signal)

    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      `/api/attempts/${ATTEMPT_ID}/failure`,
      expect.objectContaining({
        signal: controller.signal,
        body: JSON.stringify({ expectedStage: 'transcribing', outcome: 'failed' }),
      }),
      { label: 'Saving the processing state', timeoutMs: CLIENT_FAILURE_REPORT_TIMEOUT_MS },
    )
  })

  it('posts the full idempotent creation input for keepalive abandonment', async () => {
    const response = new Response(null, { status: 204 })
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => response)
    vi.stubGlobal('fetch', fetch)

    abandonUploadingAttempt(CREATE_INPUT, ATTEMPT_ID)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    expect(fetch).toHaveBeenCalledWith('/api/attempts/abandon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...CREATE_INPUT, attemptId: ATTEMPT_ID }),
      keepalive: true,
    })
  })

  it('can abandon by request id when the create response was lost', async () => {
    const response = new Response(null, { status: 204 })
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => response)
    vi.stubGlobal('fetch', fetch)

    abandonUploadingAttempt(CREATE_INPUT)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    const init = fetch.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toEqual(CREATE_INPUT)
  })
})
