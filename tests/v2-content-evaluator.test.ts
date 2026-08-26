import { describe, expect, it, vi } from 'vitest'
import { contentDetectorFromModel } from '@/lib/scoring/v2/content/adapter'
import {
  V2_CONTENT_DETECTOR_VERSION,
  type V2ContentDetectorProvider,
} from '@/lib/scoring/v2/content/contracts'
import {
  parseV2ContentResponse,
  runV2ContentEvaluation,
  V2ContentParseError,
} from '@/lib/scoring/v2/content/evaluate'
import { V2_CONTENT_SYSTEM_PROMPT } from '@/lib/scoring/v2/content/prompt'

const TRANSCRIPT = 'I think the park is good because it has a lake. The park is good for families.'
const PARK = { start: 12, end: 16, text: 'park', category: 'filler' as const }

function response(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    structure: { checks: {} },
    grammar: { findings: [] },
    vocabulary: { findings: [] },
    ...overrides,
  })
}

function provider(complete: V2ContentDetectorProvider['complete']): V2ContentDetectorProvider {
  return { name: 'fake-v2', complete }
}

describe('v2 content response validation', () => {
  it('returns separate normalized structure, grammar, and vocabulary components', () => {
    const parsed = parseV2ContentResponse(
      response({
        structure: {
          checks: {
            main_point: {
              passed: false,
              severity: 'minor',
              observation: 'The main point is delayed.',
            },
          },
        },
        grammar: {
          findings: [
            {
              kind: 'grammatical_error',
              severity: 'clear',
              quote: 'it has a lake',
              observation: 'This evidence is specific.',
            },
          ],
        },
        vocabulary: {
          findings: [
            {
              kind: 'vague_language',
              severity: 'minor',
              quote: 'good',
              observation: 'This does not name the benefit.',
            },
          ],
        },
      }),
      { transcript: TRANSCRIPT },
    )

    expect(parsed.categories.structure.component).toBe(0.9)
    expect(parsed.categories.grammar.component).toBe(0.75)
    expect(parsed.categories.vocabulary.component).toBe(0.9)
    expect(parsed.categories.structure.findings[0]?.quote).toBeNull()
    expect(parsed.categories.grammar.findings[0]?.evidence[0]).toMatchObject({
      start: expect.any(Number),
    })
  })

  it('fails missing categories in the user favor without inventing deductions', () => {
    const parsed = parseV2ContentResponse(JSON.stringify({ structure: { checks: {} } }), {
      transcript: TRANSCRIPT,
    })
    expect(parsed.categories.structure.status).toBe('checked')
    expect(parsed.categories.grammar).toMatchObject({ status: 'not_checked', component: null })
    expect(parsed.categories.vocabulary).toMatchObject({ status: 'not_checked', component: null })
  })

  it('throws only for malformed response envelopes', () => {
    expect(() => parseV2ContentResponse('not json', { transcript: TRANSCRIPT })).toThrow(
      V2ContentParseError,
    )
    expect(() => parseV2ContentResponse('[]', { transcript: TRANSCRIPT })).toThrow(
      V2ContentParseError,
    )
  })

  it('drops grammar and vocabulary findings without exact transcript evidence', () => {
    const parsed = parseV2ContentResponse(
      response({
        grammar: {
          findings: [
            { kind: 'grammatical_error', severity: 'clear', quote: 'never said', observation: 'x' },
          ],
        },
        vocabulary: {
          findings: [
            { kind: 'imprecise_wording', severity: 'minor', quote: 'not spoken', observation: 'x' },
          ],
        },
      }),
      { transcript: TRANSCRIPT },
    )
    expect(parsed.categories.grammar.findings).toEqual([])
    expect(parsed.categories.vocabulary.findings).toEqual([])
    expect(parsed.warnings.join(' ')).toMatch(/not in the transcript/)
  })

  it('requires recognized vocabulary kinds and severity values', () => {
    const parsed = parseV2ContentResponse(
      response({
        vocabulary: {
          findings: [
            { kind: 'fancy_words', severity: 'clear', quote: 'good', observation: 'x' },
            { kind: 'vague_language', severity: 'uncertain', quote: 'good', observation: 'x' },
          ],
        },
      }),
      { transcript: TRANSCRIPT },
    )
    expect(parsed.categories.vocabulary.findings).toEqual([])
    expect(parsed.categories.vocabulary.component).toBe(1)
  })

  it('accepts grammar findings only when they identify a grammatical error', () => {
    const parsed = parseV2ContentResponse(
      response({
        grammar: {
          findings: [
            {
              kind: 'style',
              severity: 'clear',
              quote: 'good',
              observation: 'This is a preference.',
            },
          ],
        },
      }),
      { transcript: TRANSCRIPT },
    )
    expect(parsed.categories.grammar.findings).toEqual([])
    expect(parsed.categories.grammar.warnings.join(' ')).toMatch(/unknown finding kind/)
  })
})

describe('v2 content evidence exclusions', () => {
  it('drops low-confidence grammar and vocabulary evidence', () => {
    const goodStart = TRANSCRIPT.indexOf('good')
    const parsed = parseV2ContentResponse(
      response({
        grammar: {
          findings: [
            { kind: 'grammatical_error', severity: 'clear', quote: 'good', observation: 'x' },
          ],
        },
        vocabulary: {
          findings: [
            { kind: 'vague_language', severity: 'minor', quote: 'lake', observation: 'x' },
          ],
        },
      }),
      {
        transcript: TRANSCRIPT,
        unreliableTranscriptSpans: [{ start: goodStart, end: goodStart + 4, confidence: 0.31 }],
      },
    )
    expect(parsed.categories.grammar.findings).toEqual([])
    expect(parsed.categories.vocabulary.findings).toHaveLength(1)
  })

  it('excludes filler, false-start, and closer claims before vocabulary can deduct', () => {
    const text = 'Um, I think it is good. You know.'
    const parsed = parseV2ContentResponse(
      response({
        vocabulary: {
          findings: [
            { kind: 'vague_language', severity: 'clear', quote: 'Um', observation: 'x' },
            { kind: 'repeated_wording', severity: 'clear', quote: 'You know', observation: 'x' },
            { kind: 'imprecise_wording', severity: 'minor', quote: 'good', observation: 'x' },
          ],
        },
      }),
      {
        transcript: text,
        mechanicallyCounted: [
          { text: 'Um', category: 'filler', start: 0, end: 2 },
          { text: 'You know', category: 'closer', start: 25, end: 33 },
          { text: 'I think', category: 'false_start', start: 4, end: 11 },
        ],
      },
    )
    expect(parsed.categories.vocabulary.findings.map((finding) => finding.quote)).toEqual(['good'])
  })

  it('keeps one claimed quote across categories and drops overlapping repeated wording', () => {
    const parsed = parseV2ContentResponse(
      response({
        grammar: {
          findings: [
            {
              kind: 'grammatical_error',
              severity: 'minor',
              quote: 'park is good',
              observation: 'x',
            },
          ],
        },
        vocabulary: {
          findings: [
            { kind: 'repeated_wording', severity: 'clear', quote: 'good', observation: 'x' },
          ],
        },
      }),
      { transcript: TRANSCRIPT },
    )
    expect(parsed.categories.grammar.findings).toHaveLength(1)
    expect(parsed.categories.vocabulary.findings).toEqual([])
    expect(parsed.warnings.join(' ')).toMatch(/earlier v2 finding/)
  })

  it('does not let malformed mechanically counted evidence create a deduction', () => {
    const parsed = parseV2ContentResponse(response(), {
      transcript: TRANSCRIPT,
      mechanicallyCounted: [PARK],
    })
    expect(parsed.categories.vocabulary.component).toBe(1)
  })
})

describe('v2 provider behavior and prompt contract', () => {
  it('retries malformed JSON once, then returns not_checked', async () => {
    const complete = vi
      .fn<V2ContentDetectorProvider['complete']>()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(response())
    const checked = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: TRANSCRIPT,
    })
    expect(checked.status).toBe('checked')
    expect(checked.calls).toBe(2)

    const failed = await runV2ContentEvaluation({
      provider: provider(async () => 'not json'),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: TRANSCRIPT,
    })
    expect(failed.status).toBe('not_checked')
    expect(failed.calls).toBe(2)
    expect(failed.categories.grammar.component).toBeNull()
  })

  it('does not retry provider outages', async () => {
    const complete = vi
      .fn<V2ContentDetectorProvider['complete']>()
      .mockRejectedValue(new Error('upstream 500'))
    const result = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: TRANSCRIPT,
    })
    expect(result.status).toBe('not_checked')
    expect(result.calls).toBe(1)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('adapts the existing transport without sharing the legacy response contract', async () => {
    const complete = vi.fn().mockResolvedValue(response())
    const adapter = contentDetectorFromModel({ name: 'legacy-transport', complete })
    await adapter.complete({
      version: V2_CONTENT_DETECTOR_VERSION,
      mode: 'interview',
      prompt: 'Tell me about a challenge.',
      transcript: TRANSCRIPT,
    })
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        system: V2_CONTENT_SYSTEM_PROMPT,
        user: expect.stringContaining('response_shape'),
      }),
    )
  })

  it('instructs precision without vocabulary-level or stylistic penalties', () => {
    expect(V2_CONTENT_SYSTEM_PROMPT).toMatch(/never penalize stylistic preference/i)
    expect(V2_CONTENT_SYSTEM_PROMPT).toMatch(/not fancy words or vocabulary level/i)
    expect(V2_CONTENT_SYSTEM_PROMPT).toMatch(/fillers, false starts, or closers/i)
  })
})
