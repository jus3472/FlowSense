import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticatedAttemptContext: vi.fn(),
  logAttemptDiagnostic: vi.fn(),
  markOwnedAttemptFailure: vi.fn(),
  transitionOwnedAttempt: vi.fn(),
}))

vi.mock('@/lib/attempts/server', () => ({
  authenticatedAttemptContext: mocks.authenticatedAttemptContext,
  logAttemptDiagnostic: mocks.logAttemptDiagnostic,
  markOwnedAttemptFailure: mocks.markOwnedAttemptFailure,
  transitionOwnedAttempt: mocks.transitionOwnedAttempt,
}))

vi.mock('@/lib/env/server', () => ({ deepgramApiKey: () => 'test-deepgram-key' }))

import { POST } from '@/app/api/transcribe/route'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const AUDIO_PATH = `${USER_ID}/${ATTEMPT_ID}.webm`
const TRANSCRIPT = 'This works well.'
const WORDS = [
  { word: 'this', start: 0.2, end: 0.5, confidence: 0.98 },
  { word: 'works', start: 0.55, end: 0.9, confidence: 0.96 },
  { word: 'well', start: 0.95, end: 1.2, confidence: 0.94 },
]

function completedMetrics(words: unknown = WORDS) {
  return {
    upload: { storage_path: AUDIO_PATH, mime_type: 'audio/webm;codecs=opus' },
    transcript: {
      provider: 'deepgram',
      model: 'nova-2',
      confidence: 0.97,
      words,
      duration_seconds: 1.5,
      quality: { status: 'usable', diagnostics: [] },
    },
  }
}

function attempt(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    audio_path: AUDIO_PATH,
    metrics: completedMetrics(),
    transcript: TRANSCRIPT,
    status,
    ...overrides,
  }
}

function adminFor(...responses: Array<{ data: Record<string, unknown> | null; error: unknown }>) {
  const queued = [...responses]
  const download = vi.fn(async () => ({ data: new Blob(['audio']), error: null }))
  const from = vi.fn(() => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => queued.shift() ?? { data: null, error: null }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    return query
  })
  return {
    admin: {
      from,
      storage: { from: vi.fn(() => ({ download })) },
    },
    download,
  }
}

function request() {
  return new Request('http://localhost/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId: ATTEMPT_ID }),
  })
}

function providerResponse() {
  return new Response(
    JSON.stringify({
      metadata: { duration: 1.5 },
      results: {
        channels: [
          {
            alternatives: [{ transcript: TRANSCRIPT, words: WORDS, confidence: 0.97 }],
          },
        ],
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transitionOwnedAttempt.mockResolvedValue(true)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('transcription retry lifecycle', () => {
  it.each(['failed', 'timed_out'] as const)(
    'atomically resumes a completed %s transcription at scoring without Deepgram',
    async (status) => {
      const setup = adminFor({ data: attempt(status), error: null })
      mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
      const provider = vi.fn()
      vi.stubGlobal('fetch', provider)

      const response = await POST(request())

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ transcript: TRANSCRIPT, wordCount: 3 })
      expect(mocks.transitionOwnedAttempt).toHaveBeenCalledExactlyOnceWith(
        setup.admin,
        USER_ID,
        ATTEMPT_ID,
        [status],
        'scoring',
      )
      expect(provider).not.toHaveBeenCalled()
      expect(setup.download).not.toHaveBeenCalled()
    },
  )

  it.each(['scoring', 'done'] as const)(
    'reuses a completed transcript already in %s without changing lifecycle state',
    async (status) => {
      const setup = adminFor({ data: attempt(status), error: null })
      mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
      const provider = vi.fn()
      vi.stubGlobal('fetch', provider)

      const response = await POST(request())

      expect(response.status).toBe(200)
      expect(mocks.transitionOwnedAttempt).not.toHaveBeenCalled()
      expect(provider).not.toHaveBeenCalled()
    },
  )

  it('joins a concurrent scoring transition instead of calling Deepgram', async () => {
    const setup = adminFor(
      { data: attempt('failed'), error: null },
      { data: attempt('scoring'), error: null },
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    mocks.transitionOwnedAttempt.mockResolvedValueOnce(false)
    const provider = vi.fn()
    vi.stubGlobal('fetch', provider)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(setup.admin.from).toHaveBeenCalledTimes(2)
    expect(provider).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'missing',
      overrides: {
        transcript: null,
        metrics: {
          upload: { storage_path: AUDIO_PATH, mime_type: 'audio/webm;codecs=opus' },
        },
      },
    },
    {
      label: 'malformed',
      overrides: { metrics: completedMetrics(WORDS.slice(0, 2)) },
    },
  ])('uses the normal provider path when stored evidence is $label', async ({ overrides }) => {
    const setup = adminFor({ data: attempt('failed', overrides), error: null })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    const provider = vi.fn(async () => providerResponse())
    vi.stubGlobal('fetch', provider)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(provider).toHaveBeenCalledTimes(1)
    expect(setup.download).toHaveBeenCalledWith(AUDIO_PATH)
    expect(mocks.transitionOwnedAttempt).toHaveBeenNthCalledWith(
      1,
      setup.admin,
      USER_ID,
      ATTEMPT_ID,
      ['failed'],
      'transcribing',
    )
    expect(mocks.transitionOwnedAttempt).toHaveBeenNthCalledWith(
      2,
      setup.admin,
      USER_ID,
      ATTEMPT_ID,
      ['transcribing'],
      'scoring',
      expect.objectContaining({ transcript: TRANSCRIPT }),
    )
  })

  it('returns a conflict when a race moves the attempt somewhere other than scoring or done', async () => {
    const setup = adminFor(
      { data: attempt('timed_out'), error: null },
      { data: attempt('transcribing'), error: null },
    )
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    mocks.transitionOwnedAttempt.mockResolvedValueOnce(false)
    const provider = vi.fn()
    vi.stubGlobal('fetch', provider)

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(provider).not.toHaveBeenCalled()
  })
})
