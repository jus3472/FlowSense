import {
  assembleV3Score,
  composeV3Recommendation,
  isV3ScorePayload,
} from '@/lib/scoring/v3/assemble'
import type { V3ContentEvaluation, V3ContentMetricResult } from '@/lib/scoring/v3/content/contracts'
import { V3_CONTENT_EVALUATOR_VERSION } from '@/lib/scoring/v3/content/contracts'
import { V3_MODE_CONFIGS } from '@/lib/scoring/v3/config'
import {
  HOW_YOU_SOUNDED_METRICS,
  V3_METRIC_IDS,
  V3_RUBRIC_VERSION,
  V3_SCORE_PAYLOAD_VERSION,
  WHAT_YOU_SAID_METRICS,
  type HowYouSoundedMetricId,
  type V3MetricEvaluation,
  type V3MetricId,
  type V3PersistedMetricScore,
  type WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'
import { describe, expect, it } from 'vitest'

function evaluation(metric: V3MetricId, component = 1): V3MetricEvaluation {
  return {
    metric,
    status: 'scored',
    component,
    explanation: `You have visible ${metric} evidence.`,
    measurements: {},
    evidence: [],
    details: [],
    warnings: [],
  }
}

function content(component = 1): V3ContentEvaluation {
  return {
    version: V3_CONTENT_EVALUATOR_VERSION,
    provider: 'test',
    status: 'checked',
    metrics: Object.fromEntries(
      WHAT_YOU_SAID_METRICS.map((metric) => [metric, evaluation(metric, component)]),
    ) as Record<WhatYouSaidMetricId, V3ContentMetricResult>,
    warnings: [],
    calls: 1,
  }
}

function sounded(component = 1): Record<HowYouSoundedMetricId, V3MetricEvaluation> {
  return Object.fromEntries(
    HOW_YOU_SOUNDED_METRICS.map((metric) => [metric, evaluation(metric, component)]),
  ) as Record<HowYouSoundedMetricId, V3MetricEvaluation>
}

describe('v3 score assembler', () => {
  it.each(['practice', 'interview', 'presentation', 'conversation'] as const)(
    'assembles the %s mode as exactly 50 plus 50',
    (mode) => {
      const score = assembleV3Score({ mode, content: content(), sounded: sounded() })
      expect(score.version).toBe(V3_SCORE_PAYLOAD_VERSION)
      expect(score.rubric_version).toBe(V3_RUBRIC_VERSION)
      expect(score.sections.what_you_said.earned_points).toBe(50)
      expect(score.sections.what_you_said.max_points).toBe(50)
      expect(score.sections.how_you_sounded.earned_points).toBe(50)
      expect(score.sections.how_you_sounded.max_points).toBe(50)
      expect(score.total_earned_points).toBe(100)
      expect(score.total_max_points).toBe(100)
      expect(isV3ScorePayload(score)).toBe(true)

      const config = V3_MODE_CONFIGS[mode]
      for (const metric of WHAT_YOU_SAID_METRICS) {
        expect(score.sections.what_you_said.metrics[metric].max_points).toBe(
          config.sections.what_you_said[metric],
        )
      }
      for (const metric of HOW_YOU_SOUNDED_METRICS) {
        expect(score.sections.how_you_sounded.metrics[metric].max_points).toBe(
          config.sections.how_you_sounded[metric],
        )
      }
    },
  )

  it('rounds metric points before summing the sections and total', () => {
    const score = assembleV3Score({
      mode: 'practice',
      content: content(0.5),
      sounded: sounded(0.5),
    })
    expect(score.sections.what_you_said.earned_points).toBe(27)
    expect(score.sections.how_you_sounded.earned_points).toBe(26)
    expect(score.total_earned_points).toBe(53)
    expect(score.total_earned_points).toBe(
      (score.sections.what_you_said.earned_points ?? 0) +
        (score.sections.how_you_sounded.earned_points ?? 0),
    )
    expect(score.total_earned_points).toBeLessThanOrEqual(100)
  })

  it('makes both the section and overall score unavailable when one metric is unavailable', () => {
    const audio = sounded()
    audio.articulation = {
      ...audio.articulation,
      status: 'unavailable',
      component: null,
      explanation: null,
      measurements: null,
      warnings: ['Audio analysis was unavailable.'],
    }
    const score = assembleV3Score({ mode: 'interview', content: content(), sounded: audio })
    expect(score.sections.what_you_said.earned_points).toBe(50)
    expect(score.sections.how_you_sounded).toMatchObject({
      status: 'unavailable',
      earned_points: null,
    })
    expect(score.total_earned_points).toBeNull()
    expect(score.recommendation).toBeNull()
    expect(isV3ScorePayload(score)).toBe(true)
  })

  it('does not accept scored metric bodies from a not-checked content envelope', () => {
    const unavailableContent = {
      ...content(),
      status: 'not_checked' as const,
      warnings: ['The content provider was unavailable.'],
    }
    const score = assembleV3Score({
      mode: 'practice',
      content: unavailableContent,
      sounded: sounded(),
    })
    expect(score.sections.what_you_said.status).toBe('not_checked')
    expect(
      Object.values(score.sections.what_you_said.metrics).every(
        (metric) => metric.status === 'not_checked' && metric.earned_points === null,
      ),
    ).toBe(true)
    expect(score.total_earned_points).toBeNull()
  })

  it('fails malformed scored evaluator values closed', () => {
    const audio = sounded()
    audio.energy = { ...audio.energy, component: Number.NaN }
    const score = assembleV3Score({ mode: 'presentation', content: content(), sounded: audio })
    expect(score.sections.how_you_sounded.metrics.energy).toMatchObject({
      status: 'unavailable',
      component: null,
      earned_points: null,
    })
    expect(score.total_earned_points).toBeNull()
  })

  it('fails malformed audio evidence closed instead of persisting a score', () => {
    const audio = sounded()
    audio.energy = {
      ...audio.energy,
      evidence: [
        {
          source: 'audio',
          start: null,
          end: null,
          coordinate: null,
          quote: 'unlocated words',
          detail: 'This evidence has no valid location.',
        },
      ],
    }
    const score = assembleV3Score({ mode: 'practice', content: content(), sounded: audio })
    expect(score.sections.how_you_sounded.metrics.energy.status).toBe('unavailable')
    expect(score.total_earned_points).toBeNull()
  })

  it('composes its recommendation only from the strongest and weakest visible metrics', () => {
    const baseContent = content(0.7)
    const contentResult: V3ContentEvaluation = {
      ...baseContent,
      metrics: {
        ...baseContent.metrics,
        answered_prompt: {
          ...baseContent.metrics.answered_prompt,
          component: 1,
          explanation: 'You answer every part of the prompt.',
        },
      },
    }
    const audio = sounded(0.8)
    audio.energy = {
      ...audio.energy,
      component: 0.3,
      explanation: 'Your pitch changes very little across the response.',
    }
    const score = assembleV3Score({ mode: 'practice', content: contentResult, sounded: audio })
    expect(score.recommendation).toEqual({
      strongest_metric: 'answered_prompt',
      weakest_metric: 'energy',
      text: 'You did well at fully addressing what the prompt asked. To improve, add more natural vocal variation so your voice sounds less flat.',
    })
    expect(score.sections.what_you_said.metrics.answered_prompt.explanation).toBe(
      'You answer every part of the prompt.',
    )
    expect(score.sections.how_you_sounded.metrics.energy.explanation).toBe(
      'Your pitch changes very little across the response.',
    )
    const allMetrics = {
      ...score.sections.what_you_said.metrics,
      ...score.sections.how_you_sounded.metrics,
    } as Record<V3MetricId, V3PersistedMetricScore>
    expect(composeV3Recommendation(allMetrics)).toEqual(score.recommendation)
  })

  it('contains only the ten visible metric identifiers', () => {
    const score = assembleV3Score({ mode: 'conversation', content: content(), sounded: sounded() })
    expect([
      ...Object.keys(score.sections.what_you_said.metrics),
      ...Object.keys(score.sections.how_you_sounded.metrics),
    ]).toEqual([...V3_METRIC_IDS])
    expect(JSON.stringify(score)).not.toMatch(/fluency|clarity|vocabulary|delivery|confidence/)
  })

  it('rejects tampered weights, totals, recommendations, and hidden metrics', () => {
    const score = assembleV3Score({ mode: 'practice', content: content(), sounded: sounded() })
    expect(
      isV3ScorePayload({
        ...score,
        sections: {
          ...score.sections,
          what_you_said: {
            ...score.sections.what_you_said,
            metrics: {
              ...score.sections.what_you_said.metrics,
              grammar: { ...score.sections.what_you_said.metrics.grammar, max_points: 99 },
            },
          },
        },
      }),
    ).toBe(false)
    expect(isV3ScorePayload({ ...score, total_earned_points: 99 })).toBe(false)
    expect(
      isV3ScorePayload({
        ...score,
        recommendation: { ...score.recommendation, text: 'A hidden quality changed this score.' },
      }),
    ).toBe(false)
    expect(
      isV3ScorePayload({
        ...score,
        sections: {
          ...score.sections,
          how_you_sounded: {
            ...score.sections.how_you_sounded,
            metrics: { ...score.sections.how_you_sounded.metrics, confidence: evaluation('pace') },
          },
        },
      }),
    ).toBe(false)
  })

  it('validates only the exact current persisted metric shape', () => {
    const current = assembleV3Score({ mode: 'practice', content: content(), sounded: sounded() })

    expect(isV3ScorePayload(current)).toBe(true)
    expect(isV3ScorePayload({ ...current, version: 'v3.score.1' })).toBe(false)
  })

  it('accepts the prior recommendation copy on stored current-version snapshots', () => {
    const score = assembleV3Score({ mode: 'practice', content: content(), sounded: sounded() })
    if (!score.recommendation) throw new Error('Expected a complete recommendation.')
    const metrics = {
      ...score.sections.what_you_said.metrics,
      ...score.sections.how_you_sounded.metrics,
    }
    const strongest = metrics[score.recommendation.strongest_metric]
    const weakest = metrics[score.recommendation.weakest_metric]
    const priorText =
      strongest.metric === weakest.metric
        ? strongest.explanation
        : `${strongest.explanation} ${weakest.explanation}`

    expect(
      isV3ScorePayload({
        ...score,
        recommendation: { ...score.recommendation, text: priorText },
      }),
    ).toBe(true)
  })
})
