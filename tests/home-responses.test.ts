import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHomeResponseData } from '@/lib/home/responses'
import {
  HOME_COMPLETED_ATTEMPT_LIMIT,
  HOME_DISPUTE_LIMIT,
  loadHomeResponseData,
} from '@/lib/home/server'
import { DELIVERY_POINTS } from '@/lib/scoring/mechanical'
import type { Database } from '@/lib/types/database'
import { v2Snapshot } from './helpers/result-snapshots'

vi.mock('server-only', () => ({}))

interface HomeRow {
  id: string
  user_id: string
  prompt_id: string | null
  prompt_text: string
  prompt_source: 'library' | 'custom' | null
  transcript: string | null
  duration_ms: number | null
  created_at: string
  score: number | null
  section_scores: unknown
  metrics: unknown
  content_result: unknown
  status: string
}

interface QueryResult {
  data: unknown
  error: unknown
}

interface Operation {
  method: string
  args: unknown[]
}

const checks = {
  answered: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  explained: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  word_choice: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  logical_order: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  no_repetition: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
}

const legacySections = {
  content: {
    earned: 50,
    max: 50,
    checks: { answered: 14, explained: 12, word_choice: 12, logical_order: 7, no_repetition: 5 },
  },
  delivery: {
    earned: 50,
    max: 50,
    metrics: { fillers: 18, mid_sentence_pauses: 14, energy: 8, pace: 6, time_to_first_word: 4 },
  },
}

const legacyMetric = (points: number) => ({
  points,
  max_points: points,
  raw: 0,
  component: 1,
  label: null,
})

const legacyMetrics = {
  delivery: {
    metrics: Object.fromEntries(
      Object.entries(DELIVERY_POINTS).map(([name, points]) => [name, legacyMetric(points)]),
    ),
    statistics: {
      word_count: 4,
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
    },
    pauses: [],
  },
}

const legacyContent = {
  status: 'checked',
  model: 'legacy-model',
  error: null,
  checks,
  extra_spans: [],
  tightened: null,
  tightened_outcome: 'none',
  dropped: [],
  points: legacySections.content.checks,
  disputes_applied: 0,
}

function row(id: string, overrides: Partial<HomeRow> = {}): HomeRow {
  return {
    id,
    user_id: 'user-1',
    prompt_id: '10000000-0000-4000-8000-000000000001',
    prompt_text: 'Describe a recent choice.',
    prompt_source: 'library',
    transcript: 'I chose to take a walk.',
    duration_ms: 12_000,
    created_at: '2026-08-27T12:00:00.000Z',
    score: null,
    section_scores: v2Snapshot(),
    metrics: null,
    content_result: null,
    status: 'done',
    ...overrides,
  }
}

function legacyRow(id: string, overrides: Partial<HomeRow> = {}): HomeRow {
  return row(id, {
    score: 100,
    section_scores: legacySections,
    metrics: legacyMetrics,
    content_result: legacyContent,
    ...overrides,
  })
}

function legacyFindingRow(id: string, overrides: Partial<HomeRow> = {}): HomeRow {
  const failingChecks = {
    ...checks,
    answered: {
      passed: false,
      severity: 'clear',
      quote: 'I chose to take a walk.',
      observation: 'The response did not answer the prompt.',
      suggestion: null,
    },
  }
  const failingPoints = { ...legacySections.content.checks, answered: 0 }
  return legacyRow(id, {
    score: 86,
    section_scores: {
      ...legacySections,
      content: { earned: 36, max: 50, checks: failingPoints },
    },
    content_result: {
      ...legacyContent,
      checks: failingChecks,
      points: failingPoints,
    },
    ...overrides,
  })
}

function forgedNote(attemptId: string) {
  return { attempt_id: attemptId, note_type: 'answered', quote: null }
}

class FakeHomeQuery implements PromiseLike<QueryResult> {
  readonly operations: Operation[] = []

  constructor(private readonly result: QueryResult) {}

  private add(method: string, ...args: unknown[]): this {
    this.operations.push({ method, args })
    return this
  }

  select(columns: string): this {
    return this.add('select', columns)
  }

  eq(column: string, value: unknown): this {
    return this.add('eq', column, value)
  }

  order(column: string, options: { ascending: boolean }): this {
    return this.add('order', column, options)
  }

  limit(value: number): this {
    return this.add('limit', value)
  }

  in(column: string, values: readonly unknown[]): this {
    return this.add('in', column, values)
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected)
  }
}

function fakeSupabase(
  attemptResult: QueryResult,
  disputeResult: QueryResult = { data: [], error: null },
): {
  client: SupabaseClient<Database>
  attemptQuery: FakeHomeQuery
  disputeQuery: FakeHomeQuery
  from: ReturnType<typeof vi.fn>
} {
  const attemptQuery = new FakeHomeQuery(attemptResult)
  const disputeQuery = new FakeHomeQuery(disputeResult)
  const from = vi.fn((table: string) => (table === 'attempts' ? attemptQuery : disputeQuery))
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    attemptQuery,
    disputeQuery,
    from,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('Home response display model', () => {
  it('uses the stored v2 score and takeaway even when the legacy score column is null', () => {
    const result = buildHomeResponseData([row('v2-latest')])

    expect(result).toMatchObject({
      latest: {
        attemptId: 'v2-latest',
        score: 81,
        summary: 'This response has 81 of 100 points.',
      },
      latestUnavailable: false,
      scores: [81],
    })
  })

  it('keeps a valid partial v2 response linkable without inventing an overall score', () => {
    const result = buildHomeResponseData(
      [row('partial', { section_scores: v2Snapshot({ notCheckedCategory: 'grammar' }) })],
      [forgedNote('partial')],
    )

    expect(result?.latest).toEqual({
      attemptId: 'partial',
      score: null,
      summary: 'Some categories were not checked, so the overall result is unavailable.',
    })
    expect(result?.scores).toEqual([])
  })

  it('preserves the stored legacy result and legacy takeaway', () => {
    const result = buildHomeResponseData([legacyRow('legacy')])

    expect(result?.latest).toEqual({
      attemptId: 'legacy',
      score: 100,
      summary: 'Your last response scored 100. Nothing cost points.',
    })
    expect(result?.scores).toEqual([100])
  })

  it('reapplies an exact valid legacy dispute without mutating the stored snapshot', () => {
    const stored = legacyFindingRow('legacy-disputed')
    const before = JSON.stringify(stored)

    const result = buildHomeResponseData(
      [stored],
      [
        {
          attempt_id: stored.id,
          note_type: 'answered',
          quote: 'I chose to take a walk.',
        },
      ],
    )

    expect(result?.latest).toEqual({
      attemptId: stored.id,
      score: 100,
      summary: 'Your last response scored 100. Nothing cost points.',
    })
    expect(result?.scores).toEqual([100])
    expect(JSON.stringify(stored)).toBe(before)
  })

  it('keeps forged legacy rows inert and collapses exact duplicates', () => {
    const stored = legacyFindingRow('legacy-filtered')
    const invalid = [
      { attempt_id: stored.id, note_type: 'explained', quote: null },
      { attempt_id: stored.id, note_type: 'answered', quote: 'mismatched quote' },
      { attempt_id: stored.id, note_type: 'answered', quote: null },
      { attempt_id: stored.id, note_type: 'word_choice_span', quote: 'forged span' },
      { attempt_id: stored.id, note_type: 'answered', quote: null },
    ]

    expect(buildHomeResponseData([stored], invalid)?.latest).toEqual({
      attemptId: stored.id,
      score: 86,
      summary: 'Your last response scored 86. Answered the question cost the most.',
    })

    const exact = {
      attempt_id: stored.id,
      note_type: 'answered',
      quote: 'I chose to take a walk.',
    }
    expect(buildHomeResponseData([stored], [exact, exact])?.latest?.score).toBe(100)
  })

  it('keeps note rows inert for v2 and unrelated attempt ids', () => {
    const stored = row('v2-with-notes')
    const result = buildHomeResponseData(
      [stored],
      [
        { attempt_id: stored.id, note_type: 'answered', quote: null },
        {
          attempt_id: 'other-attempt',
          note_type: 'answered',
          quote: 'I chose to take a walk.',
        },
      ],
    )

    expect(result?.latest).toEqual({
      attemptId: stored.id,
      score: 81,
      summary: 'This response has 81 of 100 points.',
    })
  })

  it('keeps a historical score-only attempt linkable without inventing detail or a trend', () => {
    const result = buildHomeResponseData(
      [
        row('older-valid', { created_at: '2026-08-26T12:00:00.000Z' }),
        row('score-only-latest', {
          created_at: '2026-08-27T12:00:00.000Z',
          score: 67,
          section_scores: null,
        }),
      ],
      [forgedNote('score-only-latest')],
    )

    expect(result?.latest).toEqual({ attemptId: 'score-only-latest', score: 67, summary: null })
    expect(result?.latestUnavailable).toBe(false)
    expect(result?.scores).toEqual([])
  })

  it('keeps an unsupported-version overall linkable but outside the trend cohort', () => {
    const unsupported = { ...v2Snapshot(), version: 'v3.score.1', rubric_version: 'v3' }
    const result = buildHomeResponseData(
      [
        row('unsupported', { score: 72, section_scores: unsupported }),
        row('older-v2', { created_at: '2026-08-26T12:00:00.000Z' }),
      ],
      [forgedNote('unsupported')],
    )

    expect(result?.latest).toEqual({ attemptId: 'unsupported', score: 72, summary: null })
    expect(result?.latestUnavailable).toBe(false)
    expect(result?.scores).toEqual([])
  })

  it('shows malformed stored data without an overall score as unavailable', () => {
    const result = buildHomeResponseData(
      [row('malformed', { section_scores: { version: 'v2.score.1' } })],
      [forgedNote('malformed')],
    )

    expect(result?.latest).toBeNull()
    expect(result?.latestUnavailable).toBe(true)
    expect(result?.scores).toEqual([])
  })

  it('draws scores only within the latest compatible result cohort', () => {
    const result = buildHomeResponseData([
      row('new-v2'),
      row('older-v2', { created_at: '2026-08-26T12:00:00.000Z' }),
      legacyRow('legacy', { created_at: '2026-08-25T12:00:00.000Z' }),
      row('future', {
        created_at: '2026-08-24T12:00:00.000Z',
        score: 92,
        section_scores: { ...v2Snapshot(), version: 'v3.score.1', rubric_version: 'v3' },
      }),
    ])

    expect(result?.scores).toEqual([81, 81])
  })

  it('keeps v2 trend cohorts separate by persisted mode', () => {
    const olderPractice = v2Snapshot({ mode: 'practice', component: 0.6 })
    const result = buildHomeResponseData([
      row('new-practice', { section_scores: v2Snapshot({ mode: 'practice' }) }),
      row('older-interview', {
        created_at: '2026-08-26T12:00:00.000Z',
        section_scores: v2Snapshot({ mode: 'interview', component: 0.7 }),
      }),
      row('older-presentation', {
        created_at: '2026-08-25T12:00:00.000Z',
        section_scores: v2Snapshot({ mode: 'presentation', component: 0.7 }),
      }),
      row('older-conversation', {
        created_at: '2026-08-24T12:00:00.000Z',
        section_scores: v2Snapshot({ mode: 'conversation', component: 0.7 }),
      }),
      row('oldest-practice', {
        created_at: '2026-08-23T12:00:00.000Z',
        section_scores: olderPractice,
      }),
    ])

    expect(result?.scores).toEqual([olderPractice.total_earned_points, 81])
  })

  it('uses id as the deterministic tie-break and returns no stale state after deletion', () => {
    const sameTime = '2026-08-27T12:00:00.000Z'
    const result = buildHomeResponseData([
      row('10000000-0000-4000-8000-000000000001', { created_at: sameTime }),
      legacyRow('20000000-0000-4000-8000-000000000002', { created_at: sameTime }),
    ])

    expect(result?.latest?.attemptId).toBe('20000000-0000-4000-8000-000000000002')

    const afterDeletion = buildHomeResponseData([
      row('older-surviving', { created_at: '2026-08-26T12:00:00.000Z' }),
    ])
    expect(afterDeletion?.latest?.attemptId).toBe('older-surviving')
    expect(buildHomeResponseData([])).toEqual({
      latest: null,
      latestUnavailable: false,
      recentPromptIds: [],
      scores: [],
      timestamps: [],
    })
  })

  it('fails closed for invalid query rows instead of presenting an empty account', () => {
    expect(buildHomeResponseData(null)).toBeNull()
    expect(buildHomeResponseData([{ ...row('invalid'), status: 'scoring' }])).toBeNull()
  })
})

describe('Home completed-attempt query', () => {
  it('uses one bounded owned note query for the completed attempt batch', async () => {
    const attempts = [row('latest'), row('older')]
    const setup = fakeSupabase(
      { data: attempts, error: null },
      {
        data: [
          {
            attempt_id: 'latest',
            note_type: 'answered',
            quote: null,
          },
        ],
        error: null,
      },
    )

    const result = await loadHomeResponseData(setup.client, 'user-1')

    expect(setup.from).toHaveBeenCalledTimes(2)
    expect(setup.from).toHaveBeenNthCalledWith(1, 'attempts')
    expect(setup.from).toHaveBeenNthCalledWith(2, 'note_feedback')
    expect(setup.attemptQuery.operations).toEqual([
      {
        method: 'select',
        args: [
          'id, prompt_id, prompt_text, prompt_source, transcript, duration_ms, created_at, score, section_scores, metrics, content_result, status',
        ],
      },
      { method: 'eq', args: ['user_id', 'user-1'] },
      { method: 'eq', args: ['status', 'done'] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'order', args: ['id', { ascending: false }] },
      { method: 'limit', args: [HOME_COMPLETED_ATTEMPT_LIMIT] },
    ])
    expect(setup.disputeQuery.operations).toEqual([
      { method: 'select', args: ['attempt_id, note_type, quote'] },
      { method: 'eq', args: ['user_id', 'user-1'] },
      { method: 'in', args: ['attempt_id', attempts.map((attempt) => attempt.id)] },
      { method: 'limit', args: [HOME_DISPUTE_LIMIT] },
    ])
    expect(result.status).toBe('ready')
  })

  it('keeps query failure distinct from empty and logs only bounded metadata', async () => {
    const privateValues = 'prompt transcript postgres details'
    const setup = fakeSupabase({
      data: null,
      error: { code: 'DB_UNAVAILABLE', message: privateValues, details: privateValues },
    })
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(loadHomeResponseData(setup.client, 'user-1')).resolves.toEqual({
      status: 'failure',
      reason: 'query',
    })
    expect(logging).toHaveBeenCalledOnce()
    expect(logging).toHaveBeenCalledWith('[home] data load failed', {
      operation: 'completed_attempts',
      reason: 'query',
      code: 'DB_UNAVAILABLE',
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain(privateValues)

    const empty = fakeSupabase({ data: [], error: null })
    await expect(loadHomeResponseData(empty.client, 'user-1')).resolves.toMatchObject({
      status: 'ready',
      data: { latest: null, latestUnavailable: false, scores: [] },
    })
    expect(empty.from).toHaveBeenCalledOnce()
    expect(empty.disputeQuery.operations).toEqual([])
  })

  it('fails the Home load safely when the bounded note query fails', async () => {
    const privateValues = 'forged note database details'
    const setup = fakeSupabase(
      { data: [legacyFindingRow('latest')], error: null },
      {
        data: null,
        error: { code: 'NOTE_READ_FAILED', message: privateValues, details: privateValues },
      },
    )
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(loadHomeResponseData(setup.client, 'user-1')).resolves.toEqual({
      status: 'failure',
      reason: 'query',
    })
    expect(logging).toHaveBeenCalledExactlyOnceWith('[home] data load failed', {
      operation: 'response_disputes',
      reason: 'query',
      code: 'NOTE_READ_FAILED',
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain(privateValues)
  })

  it('fails closed for malformed note rows instead of showing undisputed legacy values', async () => {
    const setup = fakeSupabase(
      { data: [legacyFindingRow('latest')], error: null },
      { data: [{ attempt_id: 'latest', note_type: 42, quote: null }], error: null },
    )
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(loadHomeResponseData(setup.client, 'user-1')).resolves.toEqual({
      status: 'failure',
      reason: 'invalid_response',
    })
    expect(logging).toHaveBeenCalledExactlyOnceWith('[home] data load failed', {
      operation: 'response_disputes',
      reason: 'invalid_response',
      code: 'unknown',
    })
  })

  it('fails closed when the bounded note query reaches its overflow sentinel', async () => {
    const setup = fakeSupabase(
      { data: [legacyFindingRow('latest')], error: null },
      {
        data: Array.from({ length: HOME_DISPUTE_LIMIT }, () => forgedNote('latest')),
        error: null,
      },
    )
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(loadHomeResponseData(setup.client, 'user-1')).resolves.toEqual({
      status: 'failure',
      reason: 'invalid_response',
    })
    expect(logging).toHaveBeenCalledExactlyOnceWith('[home] data load failed', {
      operation: 'response_disputes',
      reason: 'invalid_response',
      code: 'unknown',
    })
  })
})
