import { readFileSync } from 'node:fs'
import {
  V2_CATEGORY_LABELS,
  formatV2Measurements,
  priorityV2Category,
  strongestV2Category,
  v2CategoryViews,
  v2EvidenceTakeaway,
  v2ModeFeedback,
  v2TranscriptSegments,
} from '@/lib/results/v2'
import { V2_SCORE_PAYLOAD_VERSION, type V2ScorePayload } from '@/lib/scoring/v2/assemble'
import { describe, expect, it } from 'vitest'

function payload(overrides: Partial<V2ScorePayload> = {}): V2ScorePayload {
  const categories = Object.fromEntries(
    [
      ['fluency', 22],
      ['clarity', 20],
      ['vocabulary', 12],
      ['grammar', 12],
      ['structure', 18],
      ['delivery', 16],
    ].map(([category, max]) => [
      category,
      {
        category,
        availability: 'available',
        status: 'scored',
        component: 1,
        earned_points: max,
        max_points: max,
        measurements: {},
        evidence: [],
        deductions: [],
        warnings: [],
      },
    ]),
  ) as V2ScorePayload['categories']
  return {
    version: V2_SCORE_PAYLOAD_VERSION,
    rubric_version: 'v2',
    mode: 'practice',
    total_earned_points: 100,
    total_max_points: 100,
    categories,
    warnings: [],
    ...overrides,
  }
}

describe('v2 result helpers', () => {
  it('keeps all stable categories in the product order', () => {
    expect(v2CategoryViews(payload()).map(({ label }) => label)).toEqual([
      'Fluency',
      'Clarity',
      'Vocabulary',
      'Grammar',
      'Structure',
      'Delivery',
    ])
    expect(V2_CATEGORY_LABELS.delivery).toBe('Delivery')
  })

  it('selects strongest and next focus from scored categories only', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      fluency: { ...score.categories.fluency, component: 0.4, earned_points: 9 },
      clarity: { ...score.categories.clarity, component: 0.7, earned_points: 14 },
    }
    const partial = { ...score, categories, total_earned_points: null }
    expect(strongestV2Category(partial)?.label).toBe('Vocabulary')
    expect(priorityV2Category(partial)?.label).toBe('Fluency')
  })

  it('formats concrete measurement values and mode-specific feedback', () => {
    expect(formatV2Measurements({ word_count: 42, checked: true, ignored: 'x' })).toEqual([
      'word count: 42',
      'checked: yes',
    ])
    expect(v2ModeFeedback('interview')).toContain('interview')
  })

  it('maps only matched transcript quotes from a category that lost points', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      grammar: {
        ...score.categories.grammar,
        component: 0.5,
        earned_points: 6,
        evidence: [
          {
            source: 'transcript',
            start: 10,
            end: 12,
            quote: 'clear',
            detail: 'Use a complete sentence.',
          },
          { source: 'audio', start: 1, end: 2, quote: 'response', detail: 'Ignore timing.' },
        ],
      },
    }
    const segments = v2TranscriptSegments('A clear response is clear.', { ...score, categories })
    expect(v2EvidenceTakeaway({ ...score, categories })).toBe('Use a complete sentence.')
    expect(segments.filter((segment) => segment.type === 'highlight')).toHaveLength(1)
    expect(segments.filter((segment) => segment.type === 'highlight')[0]?.text).toBe('clear')
  })

  it('does not highlight a quote when its category did not lose points', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      grammar: {
        ...score.categories.grammar,
        evidence: [
          { source: 'transcript', start: 0, end: 5, quote: 'clear', detail: 'Not a deduction.' },
        ],
      },
    }
    expect(
      v2TranscriptSegments('A clear response.', { ...score, categories }).every(
        (segment) => segment.type === 'text',
      ),
    ).toBe(true)
  })
})

describe('v2 attempt route', () => {
  it('routes v2 payloads to their renderer without changing the legacy renderer', () => {
    const page = readFileSync('src/app/(app)/attempts/[id]/page.tsx', 'utf8')
    const legacy = readFileSync('src/components/results/results-view.tsx', 'utf8')
    const v2 = readFileSync('src/components/results/v2-results-view.tsx', 'utf8')
    expect(page).toContain("result.kind === 'v2'")
    expect(page).toContain('<ResultsView')
    expect(legacy).toContain('Try this prompt again')
    expect(v2).toContain('Try Again')
  })
})
