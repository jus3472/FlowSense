import { readAttemptResult } from '@/lib/results/attempt-result'
import { DELIVERY_POINTS } from '@/lib/scoring/mechanical'
import { V2_SCORE_PAYLOAD_VERSION } from '@/lib/scoring/v2/assemble'
import { describe, expect, it } from 'vitest'

const checks = {
  answered: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  explained: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  word_choice: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  logical_order: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
  no_repetition: { passed: true, severity: null, quote: null, observation: null, suggestion: null },
}

const metric = (points: number) => ({
  points,
  max_points: points,
  raw: 0,
  component: 1,
  label: null,
})
const metrics = Object.fromEntries(
  Object.entries(DELIVERY_POINTS).map(([name, points]) => [name, metric(points)]),
)

const legacySections = {
  content: {
    earned: 50,
    max: 50,
    checks: { answered: 14, explained: 12, word_choice: 12, logical_order: 7, no_repetition: 5 },
  },
  delivery: { earned: 50, max: 50, metrics: Object.fromEntries(Object.entries(DELIVERY_POINTS)) },
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

function legacyInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    promptText: 'Describe your day.',
    transcript: 'I took a walk.',
    durationMs: 12_000,
    createdAt: '2026-08-26T12:00:00.000Z',
    audioUrl: 'https://example.test/audio',
    score: 100,
    sectionScores: legacySections,
    metrics: {
      delivery: { metrics, statistics, pauses: [] },
    },
    contentResult: legacyContent,
    ...overrides,
  }
}

function v2Payload(partial = false) {
  const weights = {
    fluency: 22,
    clarity: 20,
    vocabulary: 12,
    grammar: 12,
    structure: 18,
    delivery: 16,
  }
  const categories = Object.fromEntries(
    Object.entries(weights).map(([category, maxPoints]) => [
      category,
      {
        category,
        availability: 'available',
        status: partial && category === 'grammar' ? 'not_checked' : 'scored',
        component: partial && category === 'grammar' ? null : 1,
        earned_points: partial && category === 'grammar' ? null : maxPoints,
        max_points: maxPoints,
        measurements: {},
        evidence: [],
        deductions: [],
        warnings: [],
      },
    ]),
  )
  return {
    version: V2_SCORE_PAYLOAD_VERSION,
    rubric_version: 'v2',
    mode: 'practice',
    total_earned_points: partial ? null : 100,
    total_max_points: 100,
    categories,
    warnings: [],
  }
}

describe('attempt result reader', () => {
  it('returns a stored legacy snapshot without recalculating it', () => {
    const stored = legacyInput({
      score: 37,
      sectionScores: { ...legacySections, content: { ...legacySections.content, earned: 9 } },
    })
    const result = readAttemptResult(stored)
    expect(result.kind).toBe('legacy')
    if (result.kind === 'legacy') {
      expect(result.attempt.score).toBe(37)
      expect(result.attempt.sections.content.earned).toBe(9)
    }
  })

  it.each([false, true])('recognizes a structurally valid %s v2 payload', (partial) => {
    const result = readAttemptResult(
      legacyInput({ score: partial ? null : 100, sectionScores: v2Payload(partial) }),
    )
    expect(result.kind).toBe('v2')
    if (result.kind === 'v2') expect(result.payload.total_earned_points).toBe(partial ? null : 100)
  })

  it('lets a genuine legacy payload win over v2 row metadata', () => {
    expect(readAttemptResult(legacyInput({ rubricVersion: 'v2' })).kind).toBe('legacy')
  })

  it('fails malformed stored JSON safely rather than casting it as legacy', () => {
    expect(readAttemptResult(legacyInput({ metrics: { delivery: { metrics: {} } } })).kind).toBe(
      'unsupported',
    )
  })

  it('fails an unknown future payload version safely', () => {
    expect(
      readAttemptResult(legacyInput({ sectionScores: { ...v2Payload(), version: 'v3.score.1' } }))
        .kind,
    ).toBe('unsupported')
  })

  it('keeps an attempt with no stored score incomplete', () => {
    expect(
      readAttemptResult(
        legacyInput({ score: null, sectionScores: null, metrics: null, contentResult: null }),
      ).kind,
    ).toBe('incomplete')
  })

  it.each([
    { capture: { duration_ms: 1 } },
    { transcript: { words: [] } },
    { practice: { additional_context: 'context' } },
  ])('keeps raw pre-score metrics incomplete', (metrics) => {
    expect(
      readAttemptResult(
        legacyInput({ score: null, sectionScores: null, contentResult: null, metrics }),
      ).kind,
    ).toBe('incomplete')
  })

  it('rejects malformed nested legacy renderer data', () => {
    expect(
      readAttemptResult(
        legacyInput({
          metrics: {
            delivery: { metrics, statistics: { ...statistics, word_count: 'four' }, pauses: [] },
          },
        }),
      ).kind,
    ).toBe('unsupported')
    expect(
      readAttemptResult(
        legacyInput({ contentResult: { ...legacyContent, extra_spans: [{ text: 1 }] } }),
      ).kind,
    ).toBe('unsupported')
  })
})
