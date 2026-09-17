import { describe, expect, it } from 'vitest'
import { metricChecks } from '@/lib/results/metric-checks'
import { v3MetricResult } from '@/lib/results/v3'
import { V3_METRIC_IDS, type V3MetricId } from '@/lib/scoring/v3/contracts'
import { v3Snapshot } from './helpers/result-snapshots'

function metric(id: V3MetricId) {
  return v3MetricResult(v3Snapshot({ component: 1 }), id)
}

describe('stored metric check explanations', () => {
  it.each(V3_METRIC_IDS)(
    'keeps %s labels stable without inventing success for unavailable evidence',
    (id) => {
      const result = metric(id)
      const scored = metricChecks(id, result, 'practice')
      const unavailable = metricChecks(
        id,
        { ...result, status: 'unavailable', component: null, earned_points: null },
        'practice',
      )
      const notChecked = metricChecks(
        id,
        { ...result, status: 'not_checked', component: null, earned_points: null },
        'practice',
      )
      expect(scored.checks.length).toBeGreaterThan(0)
      expect(unavailable.checks.every((check) => check.status === 'unavailable')).toBe(true)
      expect(notChecked.checks.every((check) => check.status === 'unavailable')).toBe(true)
      expect(unavailable.checks.map((check) => check.label)).toEqual(
        scored.checks.map((check) => check.label),
      )
      expect(notChecked.checks.map((check) => check.label)).toEqual(
        scored.checks.map((check) => check.label),
      )
      expect(
        unavailable.checks.every((check) =>
          check.findings.every(
            (item) =>
              item.observation.includes('not enough reliable evidence') && item.suggestion === null,
          ),
        ),
      ).toBe(true)
      expect(
        notChecked.checks.every((check) =>
          check.findings.every(
            (item) =>
              item.observation.includes('could not be completed') && item.suggestion === null,
          ),
        ),
      ).toBe(true)
    },
  )

  it('keeps each finding and quote under one check and supplies a missing next step', () => {
    const result = metric('specificity')
    result.component = 0.7
    result.earned_points = 6
    result.details = [
      {
        kind: 'missing_reason',
        source: 'ai',
        quote: 'I prefer summer',
        observation: 'Your preference has no supporting reason.',
        suggestion: null,
        evidence: [],
      },
    ]
    const original = structuredClone(result)
    const view = metricChecks('specificity', result, 'practice')
    const findings = view.checks.flatMap((check) => check.findings)
    expect(findings.filter((item) => item.quotes.includes('I prefer summer'))).toHaveLength(1)
    expect(
      view.checks.find((check) => check.label === 'Support and reasons')?.findings[0]?.suggestion,
    ).toBeTruthy()
    expect(result).toEqual(original)
  })

  it('does not convert safely omitted content deductions into positive claims', () => {
    const result = metric('word_choice')
    result.explanation = 'No reliable issue was counted for this metric.'
    const view = metricChecks('word_choice', result, 'practice')
    expect(view.checks.every((check) => check.status === 'unavailable')).toBe(true)
    expect(
      view.checks.every(
        (check) =>
          check.findings[0]?.observation ===
          "There isn't enough reliable feedback to suggest a change here.",
      ),
    ).toBe(true)
  })

  it('does not label positive standalone evidence as an issue', () => {
    const result = metric('grammar')
    result.evidence = [
      {
        source: 'transcript',
        start: 0,
        end: 6,
        coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
        quote: 'I walk',
        detail: 'Your sentence has a clear subject and verb.',
      },
    ]
    expect(metricChecks('grammar', result, 'practice').checks[0]?.status).toBe('clear')
  })

  it('retains findings with unrecognized labels instead of silently losing their explanation', () => {
    const result = metric('grammar')
    result.details = [
      {
        kind: 'missing_subject',
        source: 'ai',
        quote: 'find it fun',
        observation: 'Your phrase is missing a subject.',
        suggestion: 'I find it fun',
        evidence: [],
      },
    ]
    expect(metricChecks('grammar', result, 'practice').checks[0]?.findings[0]?.observation).toBe(
      'Your phrase is missing a subject.',
    )
  })

  it('uses the selected mode when relating pace to the full-credit range', () => {
    const result = metric('pace')
    result.measurements = { words_per_minute: 139, word_count: 46, pace_duration_ms: 19_900 }
    const view = metricChecks('pace', result, 'practice')
    expect(view.checks[0]?.findings[0]?.observation).toBe(
      "At 139 words per minute, you're within the 120 to 175 range used for this practice.",
    )
    expect(view.checks[0]?.findings[0]?.suggestion).toBeNull()
    expect(metricChecks('pace', result, 'presentation')).not.toEqual(view)
  })

  it('explains rounding near a pace boundary without calling the displayed boundary above itself', () => {
    const result = metric('pace')
    result.measurements = { words_per_minute: 175.1 }
    result.component = 0.998
    const view = metricChecks('pace', result, 'practice')
    expect(view.checks[0]?.findings[0]?.observation).toContain(
      "about 175 words per minute, you're just above",
    )
    expect(view.summary).toContain('close enough to keep full points')
  })

  it('keeps pause categories visible at zero and does not suggest correcting pauses within full credit', () => {
    const result = metric('paused_time')
    result.measurements = {
      total_unnatural_pause_ms: 500,
      beginning_excessive_pause_ms: 0,
      mid_thought_excessive_pause_ms: 500,
      natural_boundary_excessive_pause_ms: 0,
    }
    const view = metricChecks('paused_time', result, 'practice')
    expect(view.checks).toHaveLength(3)
    expect(view.checks.map((check) => check.status)).toEqual(['clear', 'issue', 'clear'])
    expect(view.summary).toContain('0.5 seconds')
    expect(view).not.toHaveProperty('note')
    expect(view.checks.every((check) => check.findings[0]?.suggestion === null)).toBe(true)
  })

  it('uses a concrete finding for the preview rather than the generic metric explanation', () => {
    const result = metric('answered_prompt')
    result.component = 0.5
    result.earned_points = 5
    result.explanation = 'You answered part of the prompt.'
    result.details = [
      {
        kind: 'incomplete_prompt_coverage',
        source: 'ai',
        quote: null,
        observation:
          'The response names a habit but does not end with a takeaway. A final line would complete the answer.',
        suggestion: 'End with one takeaway.',
        evidence: [],
      },
    ]
    const view = metricChecks('answered_prompt', result, 'practice')
    expect(view.summary).toBe("Your answer names a habit but doesn't end with a takeaway.")
    expect(view.checks[0]?.findings[0]?.suggestion).toBe('End with one takeaway.')
  })

  it('labels an uncertain word and explains why it does not lower a full Articulation score', () => {
    const result = metric('articulation')
    result.measurements = {
      eligible_word_count: 46,
      low_confidence_word_count: 1,
      low_confidence_proportion: 1 / 46,
    }
    result.evidence = [
      {
        source: 'deepgram_word_confidence',
        coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
        start: 4,
        end: 6,
        quote: 'at',
        detail: 'Lower recognition confidence.',
      },
    ]
    const view = metricChecks('articulation', result, 'practice')
    expect(view.summary).toContain('45 of 46 checked words')
    const detail = view.checks[0]?.findings[0]
    expect(detail?.quotesLabel).toBe('Less clear words:')
    expect(view.checks[0]?.status).toBe('issue')
    expect(detail?.quotes).toEqual(['at'])
    expect(detail?.observation).toContain("That one uncertain word doesn't lower your score.")
    expect(detail?.suggestion).toBeNull()
  })

  it('explains only the weak Energy signals and never treats a missing signal as a success', () => {
    const result = metric('energy')
    result.component = 0.8
    result.earned_points = 8
    result.measurements = {
      pitch_range_component: 1,
      pitch_variation_component: 0.4,
      non_monotony_component: 1,
      rhythm_cadence_component: null,
    }
    const view = metricChecks('energy', result, 'practice')
    expect(view.checks.map((check) => check.status)).toEqual([
      'clear',
      'deduction',
      'clear',
      'unavailable',
    ])
    expect(
      view.checks.filter((check) => check.findings[0]?.suggestion).map((check) => check.label),
    ).toEqual(['Pitch variation'])
    expect(
      view.checks.find((check) => check.label === 'Speaking rhythm')?.findings[0]?.observation,
    ).toContain('unavailable')
  })
})
