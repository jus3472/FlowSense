import { describe, expect, it } from 'vitest'
import { resultOverview } from '@/lib/results/overview'
import { v3Snapshot } from './helpers/result-snapshots'

describe('result overview', () => {
  it('uses the stored strongest metric and a concrete next step without changing the result', () => {
    const payload = v3Snapshot({ component: 1, components: { answered_prompt: 0.5 } })
    payload.recommendation = {
      ...payload.recommendation!,
      strongest_metric: 'grammar',
      weakest_metric: 'answered_prompt',
    }
    payload.sections.what_you_said.metrics.grammar.explanation =
      'Your grammar keeps your meaning clear.'
    payload.sections.what_you_said.metrics.answered_prompt.details = [
      {
        kind: 'incomplete_prompt_coverage',
        source: 'ai',
        quote: null,
        observation: 'Your answer names a habit but does not end with a takeaway.',
        suggestion: 'End with one short takeaway.',
        evidence: [],
      },
    ]
    const original = structuredClone(payload)
    expect(resultOverview(payload)).toBe(
      'Your grammar keeps your meaning clear. Try: End with one short takeaway.',
    )
    expect(payload).toEqual(original)
  })

  it('does not invent an improvement for a perfect response or a summary for partial results', () => {
    expect(resultOverview(v3Snapshot({ component: 1 }))).not.toContain('Try:')
    expect(resultOverview(v3Snapshot({ unavailableMetric: 'energy' }))).toBeNull()
    expect(resultOverview(v3Snapshot({ notCheckedMetric: 'grammar' }))).toBeNull()
  })
})
