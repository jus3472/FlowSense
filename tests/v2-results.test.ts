import { readFileSync } from 'node:fs'
import {
  V2_CATEGORY_LABELS,
  formatV2Feedback,
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
        deductions: [
          {
            quote: 'clear',
            observation: 'Use a complete sentence.',
            suggestion: 'Name the action first.',
            deduction: 0.5,
            evidence: [{ start: 2, end: 7 }],
          },
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

  it('uses the stored deduction semantics instead of generic category evidence', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      fluency: {
        ...score.categories.fluency,
        component: 0.7,
        earned_points: 15,
        deductions: [{ id: 'articulation_pace', detail: 'Pace was fast.' }],
        evidence: [
          { source: 'transcript', start: 0, end: 5, quote: 'First', detail: 'First word.' },
        ],
      },
      clarity: {
        ...score.categories.clarity,
        component: 0.8,
        earned_points: 16,
        deductions: [{ id: 'recognition_uncertainty', detail: 'Lower recognition.' }],
        evidence: [
          {
            source: 'deepgram_word_confidence',
            start: 8,
            end: 9,
            quote: 'B',
            detail: 'Recognition confidence for this word was 0.50.',
          },
          { source: 'audio_timeline', start: 0, end: 2, quote: 'First', detail: 'Audio only.' },
        ],
      },
    }
    const highlights = v2TranscriptSegments('First B.', { ...score, categories }).filter(
      (segment) => segment.type === 'highlight',
    )
    expect(highlights.map((segment) => segment.text)).toEqual(['B'])
  })

  it('maps filler and content quotes in transcript order without reusing occurrences', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      fluency: {
        ...score.categories.fluency,
        component: 0.7,
        earned_points: 15,
        deductions: [{ id: 'filler_rate', detail: 'Fillers reduced fluency.' }],
        evidence: [
          {
            source: 'transcript',
            start: 20,
            end: 22,
            quote: 'um',
            detail: 'Filler detected in the transcript.',
          },
          {
            source: 'transcript',
            start: 2,
            end: 4,
            quote: 'um',
            detail: 'Filler detected in the transcript.',
          },
          {
            source: 'transcript',
            start: 0,
            end: 1,
            quote: 'missing',
            detail: 'Filler detected in the transcript.',
          },
        ],
      },
      vocabulary: {
        ...score.categories.vocabulary,
        component: 0.5,
        earned_points: 6,
        deductions: [
          {
            quote: 'vague',
            observation: 'Choose a specific word.',
            suggestion: null,
            deduction: 0.5,
            evidence: [{ start: 3, end: 8 }],
          },
        ],
      },
    }
    const highlights = v2TranscriptSegments('um vague um', { ...score, categories }).filter(
      (segment) => segment.type === 'highlight',
    )
    expect(highlights.map((segment) => segment.text)).toEqual(['um', 'vague', 'um'])
  })

  it('formats stored feedback safely without serializing malformed deductions', () => {
    expect(
      formatV2Feedback({
        ...payload().categories.grammar,
        deductions: [{ observation: 'Be specific.', suggestion: 'Name the item.' }, 42],
      }),
    ).toEqual(['Be specific.', 'Try: Name the item.'])
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
    expect(v2).toContain('text-3xl')
    expect(v2).not.toContain('text-5xl')
  })
})
