import { describe, expect, it } from 'vitest'
import { isLegacyRecheckSnapshot } from '@/lib/attempts/legacy-recheck'
import { CHECK_NAMES } from '@/lib/scoring/content'
import { DELIVERY_POINTS } from '@/lib/scoring/mechanical'

const checks = Object.fromEntries(
  CHECK_NAMES.map((name) => [
    name,
    { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  ]),
)
const points = {
  answered: 14,
  explained: 12,
  word_choice: 12,
  logical_order: 7,
  no_repetition: 5,
}
const deliveryMetrics = Object.fromEntries(
  Object.entries(DELIVERY_POINTS).map(([name, maxPoints]) => [
    name,
    { points: maxPoints, max_points: maxPoints, raw: 0, component: 1, label: null },
  ]),
)
const statistics = {
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

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: 'done',
    rubricVersion: 'v2',
    id: 'attempt-1',
    promptText: 'Describe your day.',
    transcript: 'I took a walk.',
    durationMs: 12_000,
    createdAt: '2026-08-26T12:00:00.000Z',
    audioUrl: null,
    score: 100,
    sectionScores: {
      content: { earned: 50, max: 50, checks: points },
      delivery: {
        earned: 50,
        max: 50,
        metrics: Object.fromEntries(Object.entries(DELIVERY_POINTS)),
      },
    },
    metrics: { delivery: { metrics: deliveryMetrics, statistics, pauses: [] } },
    contentResult: {
      status: 'not_checked',
      model: null,
      error: 'Content provider unavailable.',
      checks,
      extra_spans: [],
      tightened: null,
      tightened_outcome: 'none',
      dropped: [],
      points,
      disputes_applied: 0,
    },
    ...overrides,
  }
}

describe('legacy score recheck boundary', () => {
  it('selects a valid legacy not_checked snapshot despite v2 row metadata', () => {
    expect(isLegacyRecheckSnapshot(snapshot())).toBe(true)
  })

  it('requires a completed not_checked legacy result', () => {
    expect(isLegacyRecheckSnapshot(snapshot({ status: 'scoring' }))).toBe(false)
    expect(
      isLegacyRecheckSnapshot(
        snapshot({ contentResult: { ...snapshot().contentResult, status: 'checked' } }),
      ),
    ).toBe(false)
  })

  it('rejects malformed and unsupported stored snapshots', () => {
    expect(isLegacyRecheckSnapshot(snapshot({ metrics: { delivery: { metrics: {} } } }))).toBe(
      false,
    )
    expect(
      isLegacyRecheckSnapshot(
        snapshot({ sectionScores: { version: 'v3.score.1', rubric_version: 'v3' } }),
      ),
    ).toBe(false)
  })
})
