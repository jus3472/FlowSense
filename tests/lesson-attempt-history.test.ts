import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { loadLessonAttemptHistoryForUser } from '@/lib/results/lesson-attempt-history'
import { DELIVERY_POINTS } from '@/lib/scoring/mechanical'
import type { Database } from '@/lib/types/database'
import {
  legacySectionSnapshot,
  legacyV3Snapshot,
  v2Snapshot,
  v3Snapshot,
} from './helpers/result-snapshots'

vi.mock('server-only', () => ({}))

interface FakeRow {
  id: string
  user_id: string
  lesson_id: string | null
  prompt_text: string
  transcript: string | null
  duration_ms: number | null
  created_at: string
  finished_at: string | null
  score: number | null
  section_scores: unknown
  metrics: unknown
  content_result: unknown
  status: string
}

interface Operation {
  method: string
  args: unknown[]
}

const LEGACY_METRIC = (points: number) => ({
  points,
  max_points: points,
  raw: 0,
  component: 1,
  label: null,
})

const LEGACY_METRICS = Object.fromEntries(
  Object.entries(DELIVERY_POINTS).map(([name, points]) => [name, LEGACY_METRIC(points)]),
)

const LEGACY_STATISTICS = {
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
}

const LEGACY_CHECKS = Object.fromEntries(
  ['answered', 'explained', 'word_choice', 'logical_order', 'no_repetition'].map((name) => [
    name,
    { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  ]),
)

const LEGACY_CONTENT = {
  status: 'checked',
  model: 'legacy-model',
  error: null,
  checks: LEGACY_CHECKS,
  extra_spans: [],
  tightened: null,
  tightened_outcome: 'none',
  dropped: [],
  points: legacySectionSnapshot.content.checks,
  disputes_applied: 0,
}

function row(id: string, overrides: Partial<FakeRow> = {}): FakeRow {
  const payload = v3Snapshot({ component: 0.8 })
  return {
    id,
    user_id: 'user-1',
    lesson_id: 'lesson-1',
    prompt_text: 'Describe a clear decision.',
    transcript: 'I chose the first option because it was simpler.',
    duration_ms: 12_000,
    created_at: '2026-09-01T12:00:00.000Z',
    finished_at: '2026-09-01T12:00:05.000Z',
    score: payload.total_earned_points,
    section_scores: payload,
    metrics: null,
    content_result: null,
    status: 'done',
    ...overrides,
  }
}

function legacyRow(id: string, finishedAt: string): FakeRow {
  return row(id, {
    finished_at: finishedAt,
    score: 100,
    section_scores: legacySectionSnapshot,
    metrics: {
      delivery: { metrics: LEGACY_METRICS, statistics: LEGACY_STATISTICS, pauses: [] },
    },
    content_result: LEGACY_CONTENT,
  })
}

class FakeQuery implements PromiseLike<{ data: FakeRow[] | null; error: unknown }> {
  readonly operations: Operation[] = []

  constructor(
    private readonly rows: FakeRow[],
    private readonly error: unknown = null,
  ) {}

  private add(method: string, ...args: unknown[]) {
    this.operations.push({ method, args })
    return this
  }

  select(value: string) {
    return this.add('select', value)
  }

  eq(column: string, value: unknown) {
    return this.add('eq', column, value)
  }

  neq(column: string, value: unknown) {
    return this.add('neq', column, value)
  }

  order(column: string, options: unknown) {
    return this.add('order', column, options)
  }

  range(from: number, to: number) {
    return this.add('range', from, to)
  }

  then<TResult1 = { data: FakeRow[] | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.error)
      return Promise.resolve({ data: null, error: this.error }).then(onfulfilled, onrejected)

    let output = [...this.rows]
    for (const operation of this.operations) {
      const [column, value] = operation.args
      if (operation.method === 'eq') {
        output = output.filter((item) => item[column as keyof FakeRow] === value)
      }
      if (operation.method === 'neq') {
        output = output.filter((item) => item[column as keyof FakeRow] !== value)
      }
    }
    const range = this.operations.find((operation) => operation.method === 'range')
    if (range) output = output.slice(Number(range.args[0]), Number(range.args[1]) + 1)
    return Promise.resolve({ data: output, error: null }).then(onfulfilled, onrejected)
  }
}

function fakeSupabase(rows: FakeRow[], error: unknown = null) {
  const queries: FakeQuery[] = []
  const client = {
    from: () => {
      const query = new FakeQuery(rows, error)
      queries.push(query)
      return query
    },
  } as unknown as SupabaseClient<Database>
  return { client, queries }
}

describe('structured lesson attempt history', () => {
  it('returns other viewable legacy, v2, v3, and neutral results newest first', async () => {
    const v2 = v2Snapshot({ component: 0.7 })
    const v3Score1 = legacyV3Snapshot({ component: 0.75 })
    const neutral = v3Snapshot({ unavailableMetric: 'energy' })
    const setup = fakeSupabase([
      row('current-attempt', { finished_at: '2026-09-05T12:00:00.000Z' }),
      legacyRow('legacy-attempt', '2026-09-02T12:00:00.000Z'),
      row('v2-attempt', {
        finished_at: '2026-09-03T12:00:00.000Z',
        score: v2.total_earned_points,
        section_scores: v2,
      }),
      row('v3-score-1-attempt', {
        finished_at: '2026-09-03T18:00:00.000Z',
        score: v3Score1.total_earned_points,
        section_scores: v3Score1,
      }),
      row('neutral-attempt', {
        finished_at: '2026-09-04T12:00:00.000Z',
        score: null,
        section_scores: neutral,
      }),
    ])

    await expect(
      loadLessonAttemptHistoryForUser(setup.client, 'user-1', 'lesson-1', 'current-attempt'),
    ).resolves.toEqual({
      status: 'ready',
      data: [
        {
          attemptId: 'neutral-attempt',
          score: null,
          finishedAt: '2026-09-04T12:00:00.000Z',
        },
        {
          attemptId: 'v3-score-1-attempt',
          score: v3Score1.total_earned_points,
          finishedAt: '2026-09-03T18:00:00.000Z',
        },
        {
          attemptId: 'v2-attempt',
          score: v2.total_earned_points,
          finishedAt: '2026-09-03T12:00:00.000Z',
        },
        {
          attemptId: 'legacy-attempt',
          score: 100,
          finishedAt: '2026-09-02T12:00:00.000Z',
        },
      ],
    })

    expect(setup.queries).toHaveLength(1)
    expect(setup.queries[0]?.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['user_id', 'user-1'] },
        { method: 'eq', args: ['lesson_id', 'lesson-1'] },
        { method: 'eq', args: ['status', 'done'] },
        { method: 'neq', args: ['id', 'current-attempt'] },
      ]),
    )
  })

  it('excludes unfinished, cross-lesson, malformed, and non-viewable rows', async () => {
    const setup = fakeSupabase([
      row('active', { status: 'scoring' }),
      row('other-lesson', { lesson_id: 'lesson-2' }),
      row('empty-transcript', { transcript: '   ' }),
      row('missing-result', { score: null, section_scores: null }),
      row('malformed-result', { score: 80, section_scores: { version: 'v3.score.2' } }),
      row('valid'),
    ])

    const outcome = await loadLessonAttemptHistoryForUser(
      setup.client,
      'user-1',
      'lesson-1',
      'current-attempt',
    )

    expect(outcome).toMatchObject({ status: 'ready', data: [{ attemptId: 'valid' }] })
  })

  it('falls back to created time and keeps identical timestamps deterministic', async () => {
    const setup = fakeSupabase([
      row('attempt-a', { finished_at: null, created_at: '2026-09-04T12:00:00.000Z' }),
      row('attempt-b', { finished_at: null, created_at: '2026-09-04T12:00:00.000Z' }),
    ])

    const outcome = await loadLessonAttemptHistoryForUser(
      setup.client,
      'user-1',
      'lesson-1',
      'current-attempt',
    )

    expect(outcome).toMatchObject({
      status: 'ready',
      data: [{ attemptId: 'attempt-b' }, { attemptId: 'attempt-a' }],
    })
  })

  it('returns a non-throwing failure for a query error', async () => {
    const error = { code: 'PGRST500', message: 'private database text' }
    const setup = fakeSupabase([], error)

    await expect(
      loadLessonAttemptHistoryForUser(setup.client, 'user-1', 'lesson-1', 'current-attempt'),
    ).resolves.toEqual({ status: 'failure', error })
  })
})
