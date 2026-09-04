import { describe, expect, it } from 'vitest'
import { composeV3Recommendation } from '@/lib/scoring/v3/assemble'
import {
  V3_METRIC_IDS,
  type V3MetricId,
  type V3PersistedMetricScore,
} from '@/lib/scoring/v3/contracts'

function recommendationFor(
  strongest: V3MetricId,
  weakest: V3MetricId,
  options: { weakestComponent?: number; weakestExplanation?: string } = {},
) {
  const weakestComponent = options.weakestComponent ?? 0.3
  const middleComponent = weakestComponent >= 0.8 ? 0.9 : 0.6
  const metrics = {} as Record<V3MetricId, V3PersistedMetricScore>
  for (const metric of V3_METRIC_IDS) {
    const component =
      metric === strongest ? 1 : metric === weakest ? weakestComponent : middleComponent
    metrics[metric] = {
      metric,
      status: 'scored',
      component,
      earned_points: Math.round(component * 10),
      max_points: 10,
      explanation:
        metric === weakest
          ? (options.weakestExplanation ?? `Raw explanation for ${metric}.`)
          : `Raw explanation for ${metric}.`,
      measurements: {},
      evidence: [],
      details: [],
      warnings: [],
    }
  }
  return { metrics, recommendation: composeV3Recommendation(metrics) }
}

describe('v3 recommendation coaching copy', () => {
  it.each([
    {
      strongest: 'answered_prompt',
      weakest: 'energy',
      expected:
        'You did well at fully addressing what the prompt asked. To improve, add more natural vocal variation so your voice sounds less flat.',
    },
    {
      strongest: 'structure',
      weakest: 'pace',
      expected:
        'You did well at organizing your ideas clearly. To improve, adjust your pace so your ideas are easier to follow.',
    },
    {
      strongest: 'specificity',
      weakest: 'paused_time',
      expected:
        'You did well at supporting your answer with concrete details. To improve, reduce long hesitations so your response flows more smoothly.',
    },
  ] as const)(
    'puts $strongest strength before $weakest improvement',
    ({ strongest, weakest, expected }) => {
      const recommendation = recommendationFor(strongest, weakest).recommendation

      expect(recommendation).toEqual({
        strongest_metric: strongest,
        weakest_metric: weakest,
        text: expected,
      })
      expect(recommendation!.text.indexOf('You did well')).toBeLessThan(
        recommendation!.text.indexOf('To improve'),
      )
    },
  )

  it.each([
    [
      'energy',
      'Your pitch varied by 1.74 semitones over 52 voiced frames with RMS 0.04 across 8 temporal bins.',
    ],
    ['pace', 'You spoke at 177 WPM.'],
    ['paused_time', 'You had 4.5 seconds of paused time.'],
    ['articulation', 'You had 1% low-confidence words at an SNR of 3.2 below the threshold.'],
  ] as const)('does not copy raw %s measurements into coaching', (weakest, explanation) => {
    const recommendation = recommendationFor('answered_prompt', weakest, {
      weakestExplanation: explanation,
    }).recommendation

    expect(recommendation?.text).not.toMatch(
      /1\.74|semitones|voiced frames|RMS|temporal bins|177|WPM|4\.5|seconds|1%|confidence|SNR|threshold/i,
    )
  })

  it('describes Articulation without claiming pronunciation or phoneme analysis', () => {
    const recommendation = recommendationFor('structure', 'articulation').recommendation

    expect(recommendation?.text).toContain('making each word easier to understand')
    expect(recommendation?.text).not.toMatch(/pronunciation|phoneme|accent|recognition confidence/i)
  })

  it('keeps content coaching tied to the selected content metrics', () => {
    const recommendation = recommendationFor('conciseness', 'word_choice').recommendation

    expect(recommendation).toMatchObject({
      strongest_metric: 'conciseness',
      weakest_metric: 'word_choice',
    })
    expect(recommendation?.text).toContain('keeping your response focused')
    expect(recommendation?.text).toContain('choose more precise words')
  })

  it('uses milder improvement language when the weakest metric is still strong', () => {
    const recommendation = recommendationFor('answered_prompt', 'energy', {
      weakestComponent: 0.85,
    }).recommendation

    expect(recommendation?.text).toContain('To improve even further,')
    expect(recommendation?.text).not.toContain('biggest problem')
  })

  it('does not fabricate coaching when one required metric is unavailable', () => {
    const { metrics } = recommendationFor('answered_prompt', 'energy')
    metrics.energy = {
      ...metrics.energy,
      status: 'unavailable',
      component: null,
      earned_points: null,
      explanation: null,
      measurements: null,
      warnings: ['Audio evidence was unavailable.'],
    }

    expect(composeV3Recommendation(metrics)).toBeNull()
  })
})
