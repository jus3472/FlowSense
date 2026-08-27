import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELIVERY_POINTS } from '@/lib/scoring/mechanical'
import { v2Snapshot } from './helpers/result-snapshots'

const mocks = vi.hoisted(() => ({
  authenticatedAttemptContext: vi.fn(),
  logAttemptDiagnostic: vi.fn(),
}))

vi.mock('@/lib/attempts/server', () => ({
  authenticatedAttemptContext: mocks.authenticatedAttemptContext,
  logAttemptDiagnostic: mocks.logAttemptDiagnostic,
  safeDiagnosticCode: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown',
}))

import { POST } from '@/app/api/attempts/[id]/disputes/route'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const EXACT_QUOTE = 'I chose the second approach.'

const checks = {
  answered: {
    passed: false,
    severity: 'clear',
    quote: EXACT_QUOTE,
    observation: 'The response did not answer the prompt.',
    suggestion: null,
  },
  explained: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  word_choice: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  logical_order: {
    passed: true,
    severity: null,
    quote: null,
    observation: null,
    suggestion: null,
  },
  no_repetition: {
    passed: true,
    severity: null,
    quote: null,
    observation: null,
    suggestion: null,
  },
}

const contentPoints = {
  answered: 0,
  explained: 12,
  word_choice: 12,
  logical_order: 7,
  no_repetition: 5,
}

const deliveryMetrics = Object.fromEntries(Object.entries(DELIVERY_POINTS))
const metricDetails = Object.fromEntries(
  Object.entries(DELIVERY_POINTS).map(([name, points]) => [
    name,
    { points, max_points: points, raw: 0, component: 1, label: null },
  ]),
)

const statistics = {
  word_count: 5,
  recording_ms: 12_000,
  speaking_ms: 10_000,
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
}

function legacyAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    prompt_text: 'Describe a decision.',
    transcript: EXACT_QUOTE,
    duration_ms: 12_000,
    created_at: '2026-08-27T12:00:00.000Z',
    score: 86,
    section_scores: {
      content: { earned: 36, max: 50, checks: contentPoints },
      delivery: { earned: 50, max: 50, metrics: deliveryMetrics },
    },
    metrics: { delivery: { metrics: metricDetails, statistics, pauses: [] } },
    content_result: {
      status: 'checked',
      model: 'legacy-model',
      error: null,
      checks,
      extra_spans: [],
      tightened: null,
      tightened_outcome: 'none',
      dropped: [],
      points: contentPoints,
      disputes_applied: 0,
    },
    ...overrides,
  }
}

type QueryResult<T> = { data: T; error: unknown }

function selectable<T>(result: QueryResult<T>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    then<TResult1 = QueryResult<T>, TResult2 = never>(
      onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(result).then(onfulfilled, onrejected)
    },
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

function setupAdmin({
  attempt = legacyAttempt(),
  disputes = [],
  insertError = null,
}: {
  attempt?: ReturnType<typeof legacyAttempt> | null
  disputes?: Array<{ note_type: string; quote: string | null }>
  insertError?: unknown
} = {}) {
  const attemptQuery = selectable({ data: attempt, error: null })
  const disputeQuery = selectable({ data: disputes, error: null })
  const insert = vi.fn(async () => ({ error: insertError }))
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'attempts') return attemptQuery
      return { ...disputeQuery, insert }
    }),
  }
  mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
  return { admin, attemptQuery, disputeQuery, insert }
}

function request(noteType: unknown, quote: unknown) {
  return new Request(`http://localhost/api/attempts/${ATTEMPT_ID}/disputes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteType, quote }),
  })
}

function post(noteType: unknown, quote: unknown) {
  return POST(request(noteType, quote), { params: Promise.resolve({ id: ATTEMPT_ID }) })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('legacy dispute route', () => {
  it('persists a genuine owned failing finding and recomputes without rewriting the snapshot', async () => {
    const original = legacyAttempt()
    const setup = setupAdmin({ attempt: original })

    const response = await post('answered', EXACT_QUOTE)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ score: 100, section_scores: expect.any(Object) }),
    )
    expect(setup.attemptQuery.eq).toHaveBeenCalledWith('id', ATTEMPT_ID)
    expect(setup.attemptQuery.eq).toHaveBeenCalledWith('user_id', USER_ID)
    expect(setup.insert).toHaveBeenCalledExactlyOnceWith({
      user_id: USER_ID,
      attempt_id: ATTEMPT_ID,
      note_type: 'answered',
      quote: EXACT_QUOTE,
    })
    expect(original.score).toBe(86)
    expect(original.section_scores.content.earned).toBe(36)
    expect(setup.admin.from).not.toHaveBeenCalledWith(expect.stringContaining('update'))
  })

  it('persists an exact stored word-choice span', async () => {
    const base = legacyAttempt()
    const setup = setupAdmin({
      attempt: legacyAttempt({
        content_result: {
          ...base.content_result,
          extra_spans: [{ text: 'kind of useful', category: 'imprecise' }],
        },
      }),
    })

    const response = await post('word_choice_span', 'kind of useful')

    expect(response.status).toBe(200)
    expect(setup.insert).toHaveBeenCalledExactlyOnceWith({
      user_id: USER_ID,
      attempt_id: ATTEMPT_ID,
      note_type: 'word_choice_span',
      quote: 'kind of useful',
    })
  })

  it.each([
    ['a passing check', 'explained', null],
    ['a mismatched quote', 'answered', 'second approach'],
    ['a forged note type', 'energy', null],
  ])('rejects %s', async (_label, noteType, quote) => {
    const setup = setupAdmin()

    const response = await post(noteType, quote)

    expect(response.status).toBe(400)
    expect(setup.insert).not.toHaveBeenCalled()
  })

  it('rejects structurally valid v2 attempts', async () => {
    const setup = setupAdmin({
      attempt: legacyAttempt({ score: 80, section_scores: v2Snapshot() }),
    })

    const response = await post('answered', EXACT_QUOTE)

    expect(response.status).toBe(400)
    expect(setup.insert).not.toHaveBeenCalled()
  })

  it('returns an idempotent result without inserting an existing exact dispute', async () => {
    const setup = setupAdmin({
      disputes: [{ note_type: 'answered', quote: EXACT_QUOTE }],
    })

    const response = await post('answered', EXACT_QUOTE)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ score: 100 }))
    expect(setup.insert).not.toHaveBeenCalled()
  })

  it('treats a unique-index race as the same successful dispute', async () => {
    const setup = setupAdmin({ insertError: { code: '23505', details: 'private database text' } })

    const response = await post('answered', EXACT_QUOTE)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ score: 100 }))
    expect(setup.insert).toHaveBeenCalledTimes(1)
    expect(mocks.logAttemptDiagnostic).not.toHaveBeenCalled()
  })

  it('fails closed for a missing owned attempt', async () => {
    const setup = setupAdmin({ attempt: null })

    const response = await post('answered', EXACT_QUOTE)

    expect(response.status).toBe(404)
    expect(setup.insert).not.toHaveBeenCalled()
  })
})
