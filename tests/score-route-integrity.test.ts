import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assembleScore: vi.fn(),
  assembleV2Score: vi.fn(),
  authenticatedAttemptContext: vi.fn(),
  collectPronunciationEvidence: vi.fn(),
  computeMechanical: vi.fn(),
  deepSeekComplete: vi.fn(),
  isLegacyRecheckSnapshot: vi.fn(),
  markOwnedAttemptFailure: vi.fn(),
  runContentCheckSafely: vi.fn(),
  runV2ContentEvaluation: vi.fn(),
  transitionOwnedAttempt: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

vi.mock('@/lib/attempts/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/attempts/server')>()
  return {
    ...actual,
    authenticatedAttemptContext: mocks.authenticatedAttemptContext,
    markOwnedAttemptFailure: mocks.markOwnedAttemptFailure,
    transitionOwnedAttempt: mocks.transitionOwnedAttempt,
  }
})

vi.mock('@/lib/attempts/legacy-recheck', () => ({
  isLegacyRecheckSnapshot: mocks.isLegacyRecheckSnapshot,
}))

vi.mock('@/lib/deepseek/provider', () => ({
  createDeepSeekModel: vi.fn(() => ({ name: 'deepseek', complete: mocks.deepSeekComplete })),
}))

vi.mock('@/lib/env/server', () => ({
  azureSpeechConfig: vi.fn(() => null),
  deepseekApiKey: vi.fn(() => 'test-key'),
}))

vi.mock('@/lib/pronunciation/orchestrate', () => ({
  collectPronunciationEvidence: mocks.collectPronunciationEvidence,
}))

vi.mock('@/lib/scoring/assemble', () => ({
  SCORE_VERSION: 'v1',
  assembleScore: mocks.assembleScore,
}))

vi.mock('@/lib/scoring/mechanical', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scoring/mechanical')>()
  return { ...actual, computeMechanical: mocks.computeMechanical }
})

vi.mock('@/lib/scoring/run-content', () => ({
  runContentCheckSafely: mocks.runContentCheckSafely,
}))

vi.mock('@/lib/scoring/v2/assemble', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scoring/v2/assemble')>()
  return { ...actual, assembleV2Score: mocks.assembleV2Score }
})

vi.mock('@/lib/scoring/v2/content/adapter', () => ({
  contentDetectorFromModel: vi.fn(() => ({ name: 'deepseek', complete: vi.fn() })),
}))

vi.mock('@/lib/scoring/v2/content/evaluate', () => ({
  runV2ContentEvaluation: mocks.runV2ContentEvaluation,
}))

import { POST } from '@/app/api/score/route'
import { ATTEMPT_FAILURE_CODES } from '@/lib/attempts/lifecycle'
import type { SafeContentCheckInput } from '@/lib/scoring/run-content'
import { v2Snapshot } from './helpers/result-snapshots'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const PRIVATE_PROMPT = 'Private prompt should not appear in diagnostics.'
const PRIVATE_TRANSCRIPT = 'Private transcript should not appear in diagnostics.'
const PRIVATE_DATABASE_MESSAGE = 'private database response text'
const PRIVATE_DATABASE_ERROR = {
  code: 'PGRST500',
  message: PRIVATE_DATABASE_MESSAGE,
  details: PRIVATE_TRANSCRIPT,
  hint: PRIVATE_PROMPT,
}

interface QueryResponse {
  data: unknown
  error: unknown
}

interface QueryTrace {
  filters: Array<{ column: string; value: unknown }>
}

interface AdminOptions {
  attempt: Record<string, unknown>
  concurrent?: QueryResponse
  disputes?: QueryResponse
  update?: QueryResponse
}

function singleRowQuery(response: QueryResponse, trace: QueryTrace) {
  const query = {
    eq: vi.fn((column: string, value: unknown) => {
      trace.filters.push({ column, value })
      return query
    }),
    maybeSingle: vi.fn(async () => response),
  }
  return query
}

function disputeQuery(response: QueryResponse, trace: QueryTrace) {
  let filterCount = 0
  const query = {
    eq: vi.fn((column: string, value: unknown) => {
      trace.filters.push({ column, value })
      filterCount += 1
      return filterCount === 2 ? Promise.resolve(response) : query
    }),
  }
  return query
}

function updateQuery(response: QueryResponse, trace: QueryTrace) {
  const query = {
    eq: vi.fn((column: string, value: unknown) => {
      trace.filters.push({ column, value })
      return query
    }),
    select: vi.fn(() => query),
    maybeSingle: vi.fn(async () => response),
  }
  return query
}

function adminClient(options: AdminOptions) {
  const attemptReads = [
    { data: options.attempt, error: null },
    ...(options.concurrent ? [options.concurrent] : []),
  ]
  const attemptReadTraces: QueryTrace[] = []
  const disputeTrace: QueryTrace = { filters: [] }
  const updateTrace: QueryTrace = { filters: [] }
  const updateValues: unknown[] = []

  const attempts = {
    select: vi.fn(() => {
      const trace = { filters: [] }
      attemptReadTraces.push(trace)
      return singleRowQuery(attemptReads.shift() ?? { data: null, error: null }, trace)
    }),
    update: vi.fn((values: unknown) => {
      updateValues.push(values)
      return updateQuery(options.update ?? { data: { id: ATTEMPT_ID }, error: null }, updateTrace)
    }),
  }
  const disputes = {
    select: vi.fn(() => disputeQuery(options.disputes ?? { data: [], error: null }, disputeTrace)),
  }
  const admin = {
    from: vi.fn((table: string) => (table === 'attempts' ? attempts : disputes)),
    storage: {
      from: vi.fn(() => ({ download: vi.fn() })),
    },
  }

  return {
    admin,
    attempts,
    disputes,
    attemptReadTraces,
    disputeTrace,
    updateTrace,
    updateValues,
  }
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    prompt_text: PRIVATE_PROMPT,
    audio_path: null,
    transcript: PRIVATE_TRANSCRIPT,
    duration_ms: 20_000,
    metrics: {
      capture: { duration_ms: 20_000, sample_interval_ms: 50, amplitude: [], pitch: [] },
      transcript: { words: [] },
    },
    score: null,
    section_scores: null,
    content_result: null,
    practice_mode: null,
    rubric_version: null,
    status: 'done',
    failure_code: null,
    created_at: '2026-08-27T12:00:00.000Z',
    ...overrides,
  }
}

function legacyNotCheckedAttempt() {
  const deliveryPoints = {
    fillers: 18,
    mid_sentence_pauses: 14,
    energy: 8,
    pace: 6,
    time_to_first_word: 4,
  }
  const contentPoints = {
    answered: 14,
    explained: 12,
    word_choice: 12,
    logical_order: 7,
    no_repetition: 5,
  }
  const passing = {
    passed: true,
    severity: null,
    quote: null,
    observation: null,
    suggestion: null,
  }
  return attempt({
    score: 100,
    section_scores: {
      content: { earned: 50, max: 50, checks: contentPoints },
      delivery: { earned: 50, max: 50, metrics: deliveryPoints },
    },
    metrics: {
      capture: { duration_ms: 20_000, sample_interval_ms: 50, amplitude: [], pitch: [] },
      transcript: { words: [] },
      delivery: {
        metrics: Object.fromEntries(
          Object.entries(deliveryPoints).map(([name, points]) => [
            name,
            { points, max_points: points, raw: 0, component: 1, label: null },
          ]),
        ),
        statistics: {
          word_count: 4,
          recording_ms: 20_000,
          speaking_ms: 18_000,
          clean_pause_count: 0,
          mid_sentence_pause_count: 0,
          total_silence_ms: 2_000,
          leading_silence_ms: 0,
          trailing_silence_ms: 0,
          silence_ratio: 0.1,
          longest_pause_ms: 500,
          pace_variance: 0,
          backtrack_count: 0,
          backtrack_note: null,
          counted_items: [],
          repeated_phrases: [],
          noise_floor: 0.01,
          speech_level: 0.1,
          speech_threshold: 0.02,
        },
        pauses: [],
      },
    },
    content_result: {
      status: 'not_checked',
      model: null,
      error: 'Content provider unavailable.',
      checks: {
        answered: { ...passing },
        explained: { ...passing },
        word_choice: { ...passing },
        logical_order: { ...passing },
        no_repetition: { ...passing },
      },
      extra_spans: [],
      tightened: null,
      tightened_outcome: 'none',
      dropped: [],
      points: contentPoints,
      disputes_applied: 0,
    },
  })
}

function scoreRequest() {
  return new Request('http://localhost/api/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ attemptId: ATTEMPT_ID }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isLegacyRecheckSnapshot.mockReturnValue(false)
  mocks.markOwnedAttemptFailure.mockResolvedValue(undefined)
  mocks.transitionOwnedAttempt.mockResolvedValue(true)
  mocks.collectPronunciationEvidence.mockResolvedValue(null)
  mocks.deepSeekComplete.mockResolvedValue('{}')
  mocks.computeMechanical.mockReturnValue({
    metrics: {},
    pauses: [],
    warnings: [],
    statistics: { counted_items: [], repeated_phrases: [], word_count: 4 },
  })
  mocks.runContentCheckSafely.mockResolvedValue({
    model: { name: 'deepseek' },
    parsed: {},
    error: null,
    calls: 1,
    tighten: null,
  })
  mocks.assembleScore.mockReturnValue({
    score: 82,
    section_scores: {
      delivery: { earned: 42 },
      content: { earned: 40 },
    },
    content_result: {
      status: 'checked',
      error: null,
      tightened_outcome: 'none',
    },
  })
  mocks.runV2ContentEvaluation.mockResolvedValue({ status: 'checked' })
  mocks.assembleV2Score.mockReturnValue(v2Snapshot({ component: 0.8 }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('score route database integrity', () => {
  it.each(['failed', 'timed_out'] as const)(
    'rejects a %s attempt whose recording upload was abandoned',
    async (status) => {
      const setup = adminClient({
        attempt: attempt({ status, failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned }),
      })
      mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

      const response = await POST(scoreRequest())

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        error: 'That recording was not saved and cannot be scored.',
      })
      expect(mocks.transitionOwnedAttempt).not.toHaveBeenCalled()
      expect(mocks.runContentCheckSafely).not.toHaveBeenCalled()
      expect(mocks.runV2ContentEvaluation).not.toHaveBeenCalled()
    },
  )

  it('stops a legacy recheck when the owned dispute query fails', async () => {
    mocks.isLegacyRecheckSnapshot.mockReturnValue(true)
    const setup = adminClient({
      attempt: attempt(),
      disputes: { data: null, error: PRIVATE_DATABASE_ERROR },
    })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(scoreRequest())

    const responseBody = await response.json()
    expect(response.status).toBe(500)
    expect(responseBody).toEqual({ error: 'The score could not be computed.' })
    expect(mocks.runContentCheckSafely).not.toHaveBeenCalled()
    expect(mocks.assembleScore).not.toHaveBeenCalled()
    expect(setup.attempts.update).not.toHaveBeenCalled()
    expect(mocks.transitionOwnedAttempt).not.toHaveBeenCalled()
    expect(mocks.markOwnedAttemptFailure).not.toHaveBeenCalled()
    expect(setup.disputeTrace.filters).toEqual([
      { column: 'attempt_id', value: ATTEMPT_ID },
      { column: 'user_id', value: USER_ID },
    ])
    expect(error).toHaveBeenCalledExactlyOnceWith('[attempts] operation failed', {
      operation: 'load_score_disputes',
      code: 'score_disputes_read_failed',
      attemptId: ATTEMPT_ID,
      diagnostic: 'PGRST500',
    })
    const output = JSON.stringify([error.mock.calls, responseBody])
    for (const privateValue of [PRIVATE_DATABASE_MESSAGE, PRIVATE_PROMPT, PRIVATE_TRANSCRIPT]) {
      expect(output).not.toContain(privateValue)
    }
  })

  it('preserves a legitimate empty dispute list and completes the legacy recheck', async () => {
    mocks.isLegacyRecheckSnapshot.mockReturnValue(true)
    const setup = adminClient({ attempt: attempt(), disputes: { data: [], error: null } })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const response = await POST(scoreRequest())

    expect(response.status).toBe(200)
    expect(mocks.runContentCheckSafely).toHaveBeenCalledTimes(1)
    expect(mocks.assembleScore).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ disputes: [] }),
    )
    expect(setup.attempts.update).toHaveBeenCalledTimes(1)
    expect(setup.updateTrace.filters).toContainEqual({ column: 'id', value: ATTEMPT_ID })
    expect(setup.updateTrace.filters).toContainEqual({ column: 'user_id', value: USER_ID })
  })

  it('passes the shared provider timeout through the route work budget', async () => {
    const setup = adminClient({ attempt: attempt({ status: 'scoring' }) })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    mocks.runContentCheckSafely.mockImplementationOnce(async (input: SafeContentCheckInput) => {
      const model = input.createModel()
      await model.complete(input.request)
      return { model, parsed: {}, error: null, calls: 1, tighten: null }
    })

    const response = await POST(scoreRequest())

    expect(response.status).toBe(200)
    expect(mocks.deepSeekComplete).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ timeoutMs: 30_000 }),
    )
    const scoreInput = mocks.runContentCheckSafely.mock.calls[0]?.[0] as SafeContentCheckInput
    expect(
      scoreInput.rewriteRequest?.({ previous: 'draft', mustNotAppear: [], targetWords: 4 })
        .timeoutMs,
    ).toBe(30_000)
  })

  it('starts the work budget before auth and database setup to retain persistence headroom', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const setup = adminClient({ attempt: attempt({ status: 'scoring' }) })
    mocks.authenticatedAttemptContext.mockImplementationOnce(async () => {
      vi.setSystemTime(125_000)
      return { userId: USER_ID, admin: setup.admin }
    })
    mocks.runContentCheckSafely.mockImplementationOnce(async (input: SafeContentCheckInput) => {
      const model = input.createModel()
      await model.complete(input.request)
      return { model, parsed: {}, error: null, calls: 1, tighten: null }
    })

    const response = await POST(scoreRequest())

    expect(response.status).toBe(200)
    expect(mocks.deepSeekComplete).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ timeoutMs: 25_000 }),
    )
  })

  it('finishes v2 scoring when optional pronunciation work exhausts the shared budget', async () => {
    vi.useFakeTimers()
    let pronunciationStarted!: () => void
    const started = new Promise<void>((resolve) => {
      pronunciationStarted = resolve
    })
    mocks.collectPronunciationEvidence.mockImplementationOnce(() => {
      pronunciationStarted()
      return new Promise(() => undefined)
    })
    const setup = adminClient({
      attempt: attempt({ practice_mode: 'practice', rubric_version: 'v2', status: 'scoring' }),
    })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })

    const pending = POST(scoreRequest())
    await started
    await vi.advanceTimersByTimeAsync(50_000)
    const response = await pending

    expect(response.status).toBe(200)
    expect(mocks.assembleV2Score).toHaveBeenCalledTimes(1)
    expect(mocks.transitionOwnedAttempt).toHaveBeenCalledWith(
      setup.admin,
      USER_ID,
      ATTEMPT_ID,
      ['scoring'],
      'done',
      expect.any(Object),
    )
  })

  it('makes forged and duplicate historical rows inert during a legacy recheck', async () => {
    mocks.isLegacyRecheckSnapshot.mockReturnValue(true)
    const setup = adminClient({
      attempt: legacyNotCheckedAttempt(),
      disputes: {
        data: [
          { note_type: 'explained', quote: null },
          { note_type: 'answered', quote: 'mismatched quote' },
          { note_type: 'answered', quote: null },
          { note_type: 'word_choice_span', quote: 'forged span' },
          { note_type: 'answered', quote: null },
        ],
        error: null,
      },
    })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const response = await POST(scoreRequest())

    expect(response.status).toBe(200)
    expect(mocks.assembleScore).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ disputes: [] }),
    )
  })

  it('returns a valid concurrent v2 snapshot without overwriting it', async () => {
    const concurrent = v2Snapshot({ component: 0.7 })
    const setup = adminClient({
      attempt: attempt({ practice_mode: 'practice', rubric_version: 'v2', status: 'scoring' }),
      concurrent: {
        data: { score: 70, section_scores: concurrent, content_result: { status: 'checked' } },
        error: null,
      },
    })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    mocks.transitionOwnedAttempt.mockResolvedValueOnce(false)

    const response = await POST(scoreRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      score: 70,
      section_scores: concurrent,
      content_status: 'checked',
    })
    expect(mocks.markOwnedAttemptFailure).not.toHaveBeenCalled()
    expect(setup.disputes.select).not.toHaveBeenCalled()
    expect(setup.attemptReadTraces[1]?.filters).toEqual([
      { column: 'id', value: ATTEMPT_ID },
      { column: 'user_id', value: USER_ID },
    ])
  })

  it('logs and fails safely when the concurrent v2 reread fails', async () => {
    const setup = adminClient({
      attempt: attempt({ practice_mode: 'practice', rubric_version: 'v2', status: 'scoring' }),
      concurrent: { data: null, error: PRIVATE_DATABASE_ERROR },
    })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    mocks.transitionOwnedAttempt.mockResolvedValueOnce(false)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(scoreRequest())
    const responseBody = await response.json()

    expect(response.status).toBe(500)
    expect(responseBody).toEqual({ error: 'The score could not be saved.' })
    expect(mocks.markOwnedAttemptFailure).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledExactlyOnceWith('[attempts] operation failed', {
      operation: 'load_concurrent_score',
      code: 'concurrent_score_read_failed',
      attemptId: ATTEMPT_ID,
      diagnostic: 'PGRST500',
    })
    const output = JSON.stringify([error.mock.calls, responseBody])
    for (const privateValue of [PRIVATE_DATABASE_MESSAGE, PRIVATE_PROMPT, PRIVATE_TRANSCRIPT]) {
      expect(output).not.toContain(privateValue)
    }
  })

  it.each([
    ['absent', null],
    [
      'malformed',
      {
        score: 70,
        section_scores: { version: 'v2.score.1', rubric_version: 'v2' },
        content_result: { status: 'checked' },
      },
    ],
  ])('keeps the existing failure transition for a %s concurrent snapshot', async (_label, data) => {
    const setup = adminClient({
      attempt: attempt({ practice_mode: 'practice', rubric_version: 'v2', status: 'scoring' }),
      concurrent: { data, error: null },
    })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin: setup.admin })
    mocks.transitionOwnedAttempt.mockResolvedValueOnce(false)

    const response = await POST(scoreRequest())

    expect(response.status).toBe(500)
    expect(mocks.markOwnedAttemptFailure).toHaveBeenCalledExactlyOnceWith(
      setup.admin,
      USER_ID,
      ATTEMPT_ID,
      ['scoring'],
      'failed',
      ATTEMPT_FAILURE_CODES.scoringPersistenceFailed,
    )
  })
})
