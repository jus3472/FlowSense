import { describe, expect, it } from 'vitest'
import {
  assembleV2Score,
  hasStoredScorePayload,
  isV2ScorePayload,
  shouldReuseStoredV2Score,
  V2_SCORE_PAYLOAD_VERSION,
} from '@/lib/scoring/v2/assemble'
import type { ClarityResult } from '@/lib/scoring/v2/clarity'
import type { V2ContentEvaluation } from '@/lib/scoring/v2/content/contracts'
import type { DeliveryEvaluation } from '@/lib/scoring/v2/delivery'
import type { FluencyEvaluation } from '@/lib/scoring/v2/fluency'
import { rubricFor } from '@/lib/scoring/v2/rubrics'

function fluency(component = 0.5): FluencyEvaluation {
  return {
    category: 'fluency',
    availability: 'available',
    status: 'scored',
    component,
    measurements: {
      word_count: 10,
      filler_rate_per_100_words: 0,
      filler_count: 0,
      mid_sentence_pause_count: 0,
      pause_burden_per_minute: 0,
      total_silence_ms: 0,
      leading_silence_ms: 0,
      trailing_silence_ms: 0,
      speaking_ms: 1000,
      continuity_ratio: 1,
      words_per_minute: 100,
      time_to_first_word_seconds: 0,
      restart_count: 0,
      backtrack_count: 0,
    },
    evidence: [],
    deductions: [],
    warnings: [],
  }
}

function clarity(component = 0.5): ClarityResult {
  return {
    category: 'clarity',
    availability: 'available',
    status: 'scored',
    component,
    measurements: {
      word_count: 10,
      confidence_word_count: 10,
      confidence_coverage: 1,
      low_confidence_count: 0,
      low_confidence_proportion: 0,
      median_word_confidence: 1,
      amplitude_frame_count: 10,
      speech_level: 1,
      noise_level: 0,
      speech_to_noise_ratio: 10,
    },
    evidence: [],
    deductions: [],
    warnings: [],
  }
}

function delivery(component = 0.5): DeliveryEvaluation {
  return {
    category: 'delivery',
    availability: 'available',
    status: 'scored',
    component,
    measurements: {
      pitch_spread_semitones: 3,
      voiced_frames: 40,
      amplitude_relative_mad: 0.1,
      amplitude_frames: 40,
    },
    evidence: [],
    deductions: [],
    warnings: [],
  }
}

function content(component = 0.5): V2ContentEvaluation {
  return {
    version: 'v2.content-detector.1',
    provider: 'test',
    status: 'checked',
    calls: 1,
    warnings: [],
    categories: {
      structure: {
        category: 'structure',
        status: 'checked',
        component,
        findings: [],
        measurements: {},
        warnings: [],
      },
      grammar: {
        category: 'grammar',
        status: 'checked',
        component,
        findings: [],
        measurements: {},
        warnings: [],
      },
      vocabulary: {
        category: 'vocabulary',
        status: 'checked',
        component,
        findings: [],
        measurements: {},
        warnings: [],
      },
    },
  }
}

function assemble(
  mode: 'practice' | 'interview' | 'presentation' | 'conversation',
  component = 0.5,
) {
  return assembleV2Score({
    mode,
    fluency: fluency(component),
    clarity: clarity(component),
    delivery: delivery(component),
    content: content(component),
  })
}

describe('v2 score assembler', () => {
  it.each(['practice', 'interview', 'presentation', 'conversation'] as const)(
    'applies the %s rubric with exactly 100 possible points',
    (mode) => {
      const result = assemble(mode)
      const rubric = rubricFor(mode)

      expect(result.total_max_points).toBe(100)
      expect(
        Object.values(result.categories).reduce((sum, category) => sum + category.max_points, 0),
      ).toBe(100)
      expect(result.categories.fluency.max_points).toBe(rubric.categories.fluency.weight)
      expect(result.categories.structure.max_points).toBe(rubric.categories.structure.weight)
      expect(result.total_earned_points).toBe(
        Object.values(result.categories).reduce(
          (sum, category) => sum + (category.earned_points ?? 0),
          0,
        ),
      )
    },
  )

  it('rounds each weighted category deterministically before summing', () => {
    const result = assemble('practice', 0.51)

    expect(result.categories.fluency.earned_points).toBe(11)
    expect(result.categories.clarity.earned_points).toBe(10)
    expect(result.total_earned_points).toBe(50)
  })

  it('keeps an unavailable category explicit and does not manufacture an overall score', () => {
    const result = assembleV2Score({
      mode: 'interview',
      fluency: {
        category: 'fluency',
        availability: 'unavailable',
        status: 'unavailable',
        component: null,
        measurements: null,
        evidence: [],
        deductions: [],
        warnings: ['Capture was incomplete.'],
      },
      clarity: clarity(),
      delivery: delivery(),
      content: content(),
    })

    expect(result.categories.fluency).toMatchObject({ status: 'unavailable', earned_points: null })
    expect(result.total_earned_points).toBeNull()
  })

  it('keeps partial provider failure not_checked instead of awarding content points', () => {
    const failed = content()
    failed.status = 'not_checked'
    failed.categories.grammar = {
      category: 'grammar',
      status: 'not_checked',
      component: null,
      findings: [],
      measurements: {},
      warnings: ['Provider failed.'],
    }
    const result = assembleV2Score({
      mode: 'presentation',
      fluency: fluency(),
      clarity: clarity(),
      delivery: delivery(),
      content: failed,
    })

    expect(result.categories.grammar).toMatchObject({ status: 'not_checked', earned_points: null })
    expect(result.total_earned_points).toBeNull()
  })

  it('contains malformed provider components as not_checked evidence', () => {
    const invalid = content()
    invalid.categories.vocabulary.component = Number.NaN
    const result = assembleV2Score({
      mode: 'conversation',
      fluency: fluency(),
      clarity: clarity(),
      delivery: delivery(),
      content: invalid,
    })

    expect(result.categories.vocabulary).toMatchObject({
      status: 'not_checked',
      earned_points: null,
    })
    expect(result.total_earned_points).toBeNull()
  })

  it('keeps legacy results retryable while valid v2 payloads are idempotent', () => {
    const v2 = assemble('practice')
    const legacy = { content: { earned: 50, max: 50 }, delivery: { earned: 50, max: 50 } }
    const partial = assembleV2Score({
      mode: 'practice',
      fluency: fluency(),
      clarity: clarity(),
      delivery: delivery(),
      content: {
        ...content(),
        status: 'not_checked',
        categories: {
          ...content().categories,
          grammar: {
            category: 'grammar',
            status: 'not_checked',
            component: null,
            findings: [],
            measurements: {},
            warnings: ['Provider failed.'],
          },
        },
      },
    })

    expect(v2.version).toBe(V2_SCORE_PAYLOAD_VERSION)
    expect(isV2ScorePayload(v2)).toBe(true)
    expect(hasStoredScorePayload(v2)).toBe(true)
    expect(shouldReuseStoredV2Score(v2)).toBe(true)
    expect(partial.total_earned_points).toBeNull()
    expect(isV2ScorePayload(partial)).toBe(true)
    expect(shouldReuseStoredV2Score(partial)).toBe(true)
    expect(hasStoredScorePayload(legacy)).toBe(true)
    expect(shouldReuseStoredV2Score(legacy)).toBe(false)
    expect(hasStoredScorePayload({ rubric_version: 'v2' })).toBe(false)
  })

  it('does not treat marker-only or malformed v2 JSONB as authoritative', () => {
    const v2 = assemble('interview')
    const malformed = {
      ...v2,
      categories: { ...v2.categories, fluency: { ...v2.categories.fluency, max_points: 99 } },
    }

    expect(isV2ScorePayload({ version: V2_SCORE_PAYLOAD_VERSION, rubric_version: 'v2' })).toBe(
      false,
    )
    expect(isV2ScorePayload(malformed)).toBe(false)
    expect(shouldReuseStoredV2Score(malformed)).toBe(false)
  })
})
