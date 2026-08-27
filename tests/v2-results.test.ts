import { readFileSync } from 'node:fs'
import {
  V2_CATEGORY_LABELS,
  formatV2Feedback,
  formatV2Measurements,
  priorityV2Category,
  strongestV2Category,
  v2CategoryStatusView,
  v2CategoryViews,
  v2ModeFeedback,
  v2OverallTakeaway,
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
      vocabulary: { ...score.categories.vocabulary, component: 0.9, earned_points: 11 },
      grammar: { ...score.categories.grammar, component: 0.8, earned_points: 10 },
      structure: {
        ...score.categories.structure,
        status: 'not_checked' as const,
        component: null,
        earned_points: null,
      },
      delivery: {
        ...score.categories.delivery,
        availability: 'unavailable' as const,
        status: 'unavailable' as const,
        component: null,
        earned_points: null,
      },
    }
    const partial = { ...score, categories, total_earned_points: null }
    expect(strongestV2Category(partial)?.label).toBe('Vocabulary')
    expect(priorityV2Category(partial)?.label).toBe('Fluency')
  })

  it('returns no unique strongest or priority category when the extremum is tied', () => {
    const score = payload()
    expect(strongestV2Category(score)).toBeNull()
    expect(priorityV2Category(score)).toBeNull()

    const categories = {
      ...score.categories,
      fluency: { ...score.categories.fluency, component: 0.5, earned_points: 11 },
      clarity: { ...score.categories.clarity, component: 0.5, earned_points: 10 },
    }
    expect(priorityV2Category({ ...score, categories, total_earned_points: 79 })).toBeNull()
  })

  it('does not invent a winner when the only scored categories tie in a partial result', () => {
    const score = payload()
    const categories = Object.fromEntries(
      Object.entries(score.categories).map(([category, result]) => [
        category,
        category === 'fluency' || category === 'clarity'
          ? { ...result, component: 0.6, earned_points: Math.round(result.max_points * 0.6) }
          : {
              ...result,
              availability: 'unavailable' as const,
              status: 'unavailable' as const,
              component: null,
              earned_points: null,
            },
      ]),
    ) as V2ScorePayload['categories']
    const partial = { ...score, categories, total_earned_points: null }

    expect(strongestV2Category(partial)).toBeNull()
    expect(priorityV2Category(partial)).toBeNull()
    expect(v2OverallTakeaway(partial)).toBe(
      'Required evidence was unavailable for some categories, so the overall result is unavailable.',
    )
  })

  it('describes mixed partial states without collapsing their meanings', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      grammar: {
        ...score.categories.grammar,
        status: 'not_checked' as const,
        component: null,
        earned_points: null,
      },
      delivery: {
        ...score.categories.delivery,
        availability: 'unavailable' as const,
        status: 'unavailable' as const,
        component: null,
        earned_points: null,
      },
    }

    expect(v2OverallTakeaway({ ...score, categories, total_earned_points: null })).toBe(
      'Some categories were not checked, and some lacked required evidence, so the overall result is unavailable.',
    )
  })

  it('maps scored, not-checked, and unavailable states to distinct literal copy', () => {
    const score = payload()
    expect(v2CategoryStatusView(score.categories.fluency)).toEqual({
      label: '22 / 22',
      description: null,
    })
    expect(
      v2CategoryStatusView({
        ...score.categories.grammar,
        status: 'not_checked',
        component: null,
        earned_points: null,
      }),
    ).toEqual({
      label: 'Not checked',
      description: 'This check was available, but it did not return a result.',
    })
    expect(
      v2CategoryStatusView({
        ...score.categories.clarity,
        availability: 'unavailable',
        status: 'unavailable',
        component: null,
        earned_points: null,
      }),
    ).toEqual({
      label: 'Unavailable',
      description: 'The evidence needed for this category was unavailable.',
    })
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
    expect(v2OverallTakeaway({ ...score, categories })).toBe('Use a complete sentence.')
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
            start: 6,
            end: 7,
            coordinate: { space: 'transcript', unit: 'utf16_code_unit' } as const,
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
            start: 9,
            end: 11,
            coordinate: { space: 'transcript', unit: 'utf16_code_unit' } as const,
            quote: 'um',
            detail: 'Filler detected in the transcript.',
          },
          {
            source: 'transcript',
            start: 0,
            end: 2,
            coordinate: { space: 'transcript', unit: 'utf16_code_unit' } as const,
            quote: 'um',
            detail: 'Filler detected in the transcript.',
          },
          {
            source: 'transcript',
            start: 0,
            end: 1,
            coordinate: { space: 'transcript', unit: 'utf16_code_unit' } as const,
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

  it('uses exact repeated-quote coordinates, preserves transcript case and punctuation, and deduplicates', () => {
    const score = payload()
    const transcript = 'Clear, then clear.'
    const categories = {
      ...score.categories,
      grammar: {
        ...score.categories.grammar,
        component: 0.75,
        earned_points: 9,
        deductions: [
          {
            quote: 'clear',
            observation: 'Use a complete clause.',
            suggestion: null,
            deduction: 0.25,
            evidence: [{ start: 12, end: 17 }],
          },
          {
            quote: 'clear',
            observation: 'Duplicate provider evidence.',
            suggestion: null,
            deduction: 0.1,
            evidence: [{ start: 12, end: 17 }],
          },
        ],
      },
    }

    const highlights = v2TranscriptSegments(transcript, { ...score, categories }).filter(
      (segment) => segment.type === 'highlight',
    )
    expect(highlights).toHaveLength(1)
    expect(highlights[0]?.text).toBe('clear')
    expect(v2TranscriptSegments(transcript, { ...score, categories })[0]).toEqual({
      type: 'text',
      text: 'Clear, then ',
    })
  })

  it('does not guess a later occurrence for quote-only or audio-time evidence', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      fluency: {
        ...score.categories.fluency,
        component: 0.8,
        earned_points: 18,
        deductions: [{ id: 'filler_rate', detail: 'Fillers reduced fluency.' }],
        evidence: [
          {
            source: 'transcript',
            start: 1,
            end: 1.2,
            quote: 'um',
            detail: 'Filler detected in the transcript.',
          },
        ],
      },
    }
    expect(
      v2TranscriptSegments('um then um', { ...score, categories }).filter(
        (segment) => segment.type === 'highlight',
      ),
    ).toEqual([])
  })

  it('preserves exact legacy transcript offsets without coordinate metadata', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      fluency: {
        ...score.categories.fluency,
        component: 0.8,
        earned_points: 18,
        deductions: [{ id: 'filler_rate', detail: 'Fillers reduced fluency.' }],
        evidence: [
          {
            source: 'transcript',
            start: 8,
            end: 10,
            quote: 'um',
            detail: 'Filler detected in the transcript.',
          },
          {
            source: 'transcript',
            start: 3,
            end: 5,
            quote: 'um',
            detail: 'Filler detected in the transcript.',
          },
        ],
      },
    }
    const highlights = v2TranscriptSegments('um then um', { ...score, categories }).filter(
      (segment) => segment.type === 'highlight',
    )
    expect(highlights.map((segment) => segment.text)).toEqual(['um'])
    expect(highlights[0]).toMatchObject({ text: 'um', label: expect.stringContaining('Fluency') })
  })

  it('does not reinterpret legacy Clarity seconds as transcript characters', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      clarity: {
        ...score.categories.clarity,
        component: 0.8,
        earned_points: 16,
        deductions: [{ id: 'recognition_uncertainty', detail: 'Lower recognition.' }],
        evidence: [
          {
            source: 'deepgram_word_confidence',
            start: 0,
            end: 2,
            quote: 'um',
            detail: 'Recognition confidence for this word was 0.40.',
          },
        ],
      },
    }
    expect(
      v2TranscriptSegments('um then um', { ...score, categories }).filter(
        (segment) => segment.type === 'highlight',
      ),
    ).toEqual([])
  })

  it('formats stored feedback safely without serializing malformed deductions', () => {
    expect(
      formatV2Feedback({
        ...payload().categories.grammar,
        deductions: [{ observation: 'Be specific.', suggestion: 'Name the item.' }, 42],
      }),
    ).toEqual(['Be specific.', 'Try: Name the item.'])
  })

  it('always gives a factual takeaway for mechanical-only, full, and partial results', () => {
    const score = payload()
    const mechanical = {
      ...score,
      total_earned_points: 93,
      categories: {
        ...score.categories,
        fluency: {
          ...score.categories.fluency,
          component: 0.7,
          earned_points: 15,
          deductions: [{ id: 'articulation_pace', detail: '165 words per minute.' }],
        },
      },
    }
    expect(v2OverallTakeaway(mechanical)).toBe('165 words per minute.')
    expect(v2OverallTakeaway(score)).toBe('No category lost points in this response.')
    expect(v2OverallTakeaway({ ...score, total_earned_points: null })).toBe(
      'The overall result is unavailable.',
    )
  })

  it('uses a persisted deduction only from the uniquely lowest scored category', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      fluency: {
        ...score.categories.fluency,
        component: 0.7,
        earned_points: 15,
        deductions: [{ id: 'filler_rate', detail: 'Two fillers affected fluency.' }],
      },
      grammar: {
        ...score.categories.grammar,
        component: 0.5,
        earned_points: 6,
        deductions: [
          {
            kind: 'sentence_boundary',
            observation: 'One sentence boundary made the response harder to follow.',
          },
        ],
      },
    }

    expect(v2OverallTakeaway({ ...score, categories, total_earned_points: 79 })).toBe(
      'One sentence boundary made the response harder to follow.',
    )
  })

  it('uses neutral overall points when the lowest scored component is tied', () => {
    const score = payload()
    const categories = {
      ...score.categories,
      fluency: {
        ...score.categories.fluency,
        component: 0.5,
        earned_points: 11,
        deductions: [{ id: 'filler_rate', detail: 'Fluency deduction.' }],
      },
      clarity: {
        ...score.categories.clarity,
        component: 0.5,
        earned_points: 10,
        deductions: [{ id: 'recognition_uncertainty', detail: 'Clarity deduction.' }],
      },
    }

    expect(v2OverallTakeaway({ ...score, categories, total_earned_points: 79 })).toBe(
      'This response has 79 of 100 points.',
    )
  })

  it('drops non-finite evolving measurements', () => {
    expect(formatV2Measurements({ valid: 1, invalid: Number.NaN, infinite: Infinity })).toEqual([
      'valid: 1',
    ])
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
