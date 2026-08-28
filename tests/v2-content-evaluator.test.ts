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
import { buildV2ContentUserPrompt, V2_CONTENT_SYSTEM_PROMPT } from '@/lib/scoring/v2/content/prompt'
import {
  STRUCTURE_PRECEDENCE_VERSION,
  applyStructurePrecedenceVNext,
} from '@/lib/scoring/v2/content/structure-next'

const TRANSCRIPT = 'I think the park is good because it has a lake. The park is good for families.'
const PARK = { start: 12, end: 16, text: 'park', category: 'filler' as const }

function structure(overrides: Record<string, unknown> = {}) {
  const passed = { passed: true, severity: null, quote: null, observation: null, suggestion: null }
  return {
    checks: {
      answered_prompt: passed,
      main_point: passed,
      logical_progression: passed,
      relevant_support: passed,
      unnecessary_repetition: passed,
      topic_drift: passed,
      completion: passed,
      ...overrides,
    },
  }
}

function response(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: V2_CONTENT_DETECTOR_VERSION,
    structure: structure(),
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
        structure: structure({
          main_point: {
            passed: false,
            severity: 'minor',
            quote: null,
            observation: 'The main point is delayed.',
            suggestion: null,
          },
        }),
        grammar: {
          findings: [
            {
              kind: 'grammatical_error',
              severity: 'clear',
              quote: 'it has a lake',
              observation: 'This evidence is specific.',
              suggestion: null,
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
              suggestion: null,
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

  it('classifies a structure-only response as schema-invalid with ordered missing sections', () => {
    try {
      parseV2ContentResponse(
        JSON.stringify({ version: V2_CONTENT_DETECTOR_VERSION, structure: structure() }),
        { transcript: TRANSCRIPT },
      )
      throw new Error('Expected the partial content response to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(V2ContentParseError)
      expect(error).toMatchObject({
        code: 'schema_invalid',
        missingSections: ['grammar', 'vocabulary'],
      })
    }
  })

  it('throws only for malformed response envelopes', () => {
    expect(() => parseV2ContentResponse('not json', { transcript: TRANSCRIPT })).toThrow(
      V2ContentParseError,
    )
    expect(() => parseV2ContentResponse('[]', { transcript: TRANSCRIPT })).toThrow(
      V2ContentParseError,
    )
  })

  it('requires the exact response version before interpreting any category', () => {
    expect(() =>
      parseV2ContentResponse(JSON.stringify({ structure: structure() }), {
        transcript: TRANSCRIPT,
      }),
    ).toThrow(/unsupported version/)
    expect(() =>
      parseV2ContentResponse(
        JSON.stringify({
          version: 'v1',
          structure: structure(),
          grammar: { findings: [] },
          vocabulary: { findings: [] },
        }),
        { transcript: TRANSCRIPT },
      ),
    ).toThrow(/unsupported version/)
    expect(() =>
      parseV2ContentResponse(
        JSON.stringify({
          version: 'v2.content-detector.2',
          structure: structure(),
          grammar: { findings: [] },
          vocabulary: { findings: [] },
        }),
        { transcript: TRANSCRIPT },
      ),
    ).toThrow(/unsupported version/)
  })

  it('rejects an incomplete structure envelope and validates passed checks', () => {
    expect(() =>
      parseV2ContentResponse(
        response({
          structure: {
            checks: { main_point: { passed: false, severity: 'clear', observation: 'x' } },
          },
        }),
        { transcript: TRANSCRIPT },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'schema_invalid',
        missingSections: ['structure'],
      }),
    )

    const passed = parseV2ContentResponse(response({ structure: structure() }), {
      transcript: TRANSCRIPT,
    })
    expect(passed.categories.structure).toMatchObject({
      status: 'checked',
      component: 1,
      findings: [],
    })

    expect(() =>
      parseV2ContentResponse(
        response({ structure: structure({ completion: { passed: true, severity: 'minor' } }) }),
        { transcript: TRANSCRIPT },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'schema_invalid',
        missingSections: ['structure'],
      }),
    )
  })

  it('drops grammar and vocabulary findings without exact transcript evidence', () => {
    const parsed = parseV2ContentResponse(
      response({
        grammar: {
          findings: [
            {
              kind: 'grammatical_error',
              severity: 'clear',
              quote: 'never said',
              observation: 'x',
              suggestion: null,
            },
          ],
        },
        vocabulary: {
          findings: [
            {
              kind: 'imprecise_wording',
              severity: 'minor',
              quote: 'not spoken',
              observation: 'x',
              suggestion: null,
            },
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
              suggestion: null,
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
            {
              kind: 'grammatical_error',
              severity: 'clear',
              quote: 'good',
              observation: 'x',
              suggestion: null,
            },
          ],
        },
        vocabulary: {
          findings: [
            {
              kind: 'vague_language',
              severity: 'minor',
              quote: 'lake',
              observation: 'x',
              suggestion: null,
            },
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

  it('uses transcript character offsets derived from recognized word evidence', () => {
    const recognizedWord = {
      word: 'lake',
      transcriptStart: TRANSCRIPT.indexOf('lake'),
      confidence: 0.22,
    }
    const parsed = parseV2ContentResponse(
      response({
        vocabulary: {
          findings: [
            {
              kind: 'vague_language',
              severity: 'minor',
              quote: 'lake',
              observation: 'x',
              suggestion: null,
            },
          ],
        },
      }),
      {
        transcript: TRANSCRIPT,
        unreliableTranscriptSpans: [
          {
            start: recognizedWord.transcriptStart,
            end: recognizedWord.transcriptStart + recognizedWord.word.length,
            confidence: recognizedWord.confidence,
          },
        ],
      },
    )
    expect(parsed.categories.vocabulary.findings).toEqual([])
  })

  it('uses exact provider coordinates for the intended repeated quote without guessing', () => {
    const repeated = 'Clear first. Then clear again.'
    const secondStart = repeated.lastIndexOf('clear')
    const parsed = parseV2ContentResponse(
      response({
        grammar: {
          findings: [
            {
              kind: 'grammatical_error',
              severity: 'minor',
              quote: 'clear',
              start: secondStart,
              end: secondStart + 5,
              observation: 'This exact occurrence is the evidence.',
              suggestion: null,
            },
          ],
        },
      }),
      { transcript: repeated },
    )
    expect(parsed.categories.grammar.findings[0]?.evidence).toEqual([
      { start: secondStart, end: secondStart + 5 },
    ])

    const invalid = parseV2ContentResponse(
      response({
        grammar: {
          findings: [
            {
              kind: 'grammatical_error',
              severity: 'minor',
              quote: 'clear',
              start: 1,
              end: 6,
              observation: 'The coordinates do not match the quote.',
              suggestion: null,
            },
          ],
        },
      }),
      { transcript: repeated },
    )
    expect(invalid.categories.grammar.findings).toEqual([])
    expect(invalid.categories.grammar.warnings.join(' ')).toMatch(/coordinates did not match/)
  })

  it('keeps distinct exact occurrences of the same quote and deduplicates only overlap', () => {
    const repeated = 'clear then clear'
    const finding = (start: number, observation: string) => ({
      kind: 'grammatical_error',
      severity: 'minor',
      quote: 'clear',
      start,
      end: start + 5,
      observation,
      suggestion: null,
    })
    const parsed = parseV2ContentResponse(
      response({
        grammar: {
          findings: [
            finding(0, 'The first occurrence is independent.'),
            finding(11, 'The second occurrence is independent.'),
            finding(11, 'This duplicates the second span.'),
          ],
        },
      }),
      { transcript: repeated },
    )

    expect(parsed.categories.grammar.findings.map((item) => item.evidence[0])).toEqual([
      { start: 0, end: 5 },
      { start: 11, end: 16 },
    ])
    expect(parsed.categories.grammar.warnings.join(' ')).toMatch(/overlaps an earlier v2 finding/)
  })

  it('ignores invalid confidence and offset evidence rather than charging from it', () => {
    const parsed = parseV2ContentResponse(
      response({
        vocabulary: {
          findings: [
            {
              kind: 'vague_language',
              severity: 'minor',
              quote: 'lake',
              observation: 'x',
              suggestion: null,
            },
          ],
        },
      }),
      {
        transcript: TRANSCRIPT,
        unreliableTranscriptSpans: [{ start: 0, end: 4, confidence: 2 }],
      },
    )
    expect(parsed.categories.vocabulary.findings).toHaveLength(1)
  })

  it('excludes filler, false-start, and closer claims before vocabulary can deduct', () => {
    const text = 'Um, I think it is good. You know.'
    const parsed = parseV2ContentResponse(
      response({
        vocabulary: {
          findings: [
            {
              kind: 'vague_language',
              severity: 'clear',
              quote: 'Um',
              observation: 'x',
              suggestion: null,
            },
            {
              kind: 'repeated_wording',
              severity: 'clear',
              quote: 'You know',
              observation: 'x',
              suggestion: null,
            },
            {
              kind: 'imprecise_wording',
              severity: 'minor',
              quote: 'good',
              observation: 'x',
              suggestion: null,
            },
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
              suggestion: null,
            },
          ],
        },
        vocabulary: {
          findings: [
            {
              kind: 'repeated_wording',
              severity: 'clear',
              quote: 'good',
              observation: 'x',
              suggestion: null,
            },
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

  it('caps untrusted finding arrays before they can manufacture unbounded deductions', () => {
    const parsed = parseV2ContentResponse(
      response({
        vocabulary: {
          findings: Array.from({ length: 20 }, () => ({
            kind: 'vague_language',
            severity: 'minor',
            quote: 'lake',
            observation: 'x',
            suggestion: null,
          })),
        },
      }),
      { transcript: TRANSCRIPT },
    )
    expect(parsed.categories.vocabulary.findings).toHaveLength(1)
    expect(parsed.categories.vocabulary.warnings.join(' ')).toMatch(/truncated to 8/)
  })
})

describe('next-version Structure semantic precedence', () => {
  it('counts one null-span missing-answer problem once with deterministic precedence', () => {
    const failed = (observation: string) => ({
      passed: false,
      severity: 'clear',
      quote: null,
      observation,
      suggestion: null,
    })
    const parsed = parseV2ContentResponse(
      response({
        structure: structure({
          answered_prompt: failed('The response does not answer the prompt.'),
          main_point: failed('No main point is present.'),
          relevant_support: failed('No support is present.'),
          completion: failed('The response is incomplete.'),
        }),
      }),
      { transcript: TRANSCRIPT },
    )

    // The historical parser remains unchanged until a registry selects the policy.
    expect(parsed.categories.structure.findings).toHaveLength(4)
    const next = applyStructurePrecedenceVNext(parsed.categories.structure)
    expect(next.version).toBe(STRUCTURE_PRECEDENCE_VERSION)
    expect(next.result.findings.map((finding) => finding.kind)).toEqual(['answered_prompt'])
    expect(next.result.component).toBe(0.75)
    expect(next.exclusions).toEqual([
      {
        kept: 'answered_prompt',
        excluded: 'main_point',
        reason: 'same_whole_response_problem',
      },
      {
        kept: 'answered_prompt',
        excluded: 'relevant_support',
        reason: 'same_whole_response_problem',
      },
      {
        kept: 'answered_prompt',
        excluded: 'completion',
        reason: 'same_whole_response_problem',
      },
    ])
  })

  it('preserves quote-anchored and independent Structure findings', () => {
    const parsed = parseV2ContentResponse(
      response({
        structure: structure({
          answered_prompt: {
            passed: false,
            severity: 'minor',
            quote: null,
            observation: 'The answer is incomplete.',
            suggestion: null,
          },
          main_point: {
            passed: false,
            severity: 'minor',
            quote: 'The park is good',
            observation: 'The main point is delayed here.',
            suggestion: null,
          },
          topic_drift: {
            passed: false,
            severity: 'minor',
            quote: null,
            observation: 'The response changes topic.',
            suggestion: null,
          },
        }),
      }),
      { transcript: TRANSCRIPT },
    )
    const next = applyStructurePrecedenceVNext(parsed.categories.structure)
    expect(next.result.findings.map((finding) => finding.kind)).toEqual([
      'answered_prompt',
      'main_point',
      'topic_drift',
    ])
    expect(next.exclusions).toEqual([])
  })
})

describe('v2 provider behavior and prompt contract', () => {
  it('retries malformed JSON once and accepts a valid second response', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
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
    expect(complete).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith({
      provider: 'deepseek',
      model: 'fake-v2',
      code: 'malformed_json',
      status: null,
    })
    warning.mockRestore()
  })

  it('returns safe not_checked content after both malformed responses fail', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const complete = vi.fn<V2ContentDetectorProvider['complete']>().mockResolvedValue('not json')
    const failed = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: TRANSCRIPT,
    })
    expect(failed.status).toBe('not_checked')
    expect(failed.calls).toBe(2)
    expect(failed.categories.grammar.component).toBeNull()
    expect(failed.warnings).toEqual(['The content provider was unavailable.'])
    expect(complete).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenNthCalledWith(1, {
      provider: 'deepseek',
      model: 'fake-v2',
      code: 'malformed_json',
      status: null,
    })
    expect(warning).toHaveBeenNthCalledWith(2, {
      provider: 'deepseek',
      model: 'fake-v2',
      code: 'malformed_json',
      status: null,
    })
    warning.mockRestore()
  })

  it('retries a wholly schema-invalid versioned response and accepts a valid second response', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const schemaInvalid = JSON.stringify({
      version: V2_CONTENT_DETECTOR_VERSION,
      structure: {},
      grammar: {},
      vocabulary: {},
    })
    const complete = vi
      .fn<V2ContentDetectorProvider['complete']>()
      .mockResolvedValueOnce(schemaInvalid)
      .mockResolvedValueOnce(response())

    const result = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: TRANSCRIPT,
    })

    expect(result.status).toBe('checked')
    expect(result.calls).toBe(2)
    expect(complete).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledWith({
      provider: 'deepseek',
      model: 'fake-v2',
      code: 'schema_invalid',
      status: null,
    })
    warning.mockRestore()
  })

  it('returns safe not_checked content after both wholly schema-invalid responses fail', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const complete = vi.fn<V2ContentDetectorProvider['complete']>().mockResolvedValue(
      JSON.stringify({
        version: V2_CONTENT_DETECTOR_VERSION,
        structure: {},
        grammar: {},
        vocabulary: {},
      }),
    )

    const result = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: TRANSCRIPT,
    })

    expect(result).toMatchObject({
      status: 'not_checked',
      calls: 2,
      warnings: ['structure was missing', 'grammar was missing', 'vocabulary was missing'],
      categories: {
        structure: {
          status: 'not_checked',
          component: null,
          warnings: ['structure was missing'],
        },
        grammar: {
          status: 'not_checked',
          component: null,
          warnings: ['grammar was missing'],
        },
        vocabulary: {
          status: 'not_checked',
          component: null,
          warnings: ['vocabulary was missing'],
        },
      },
    })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenNthCalledWith(1, {
      provider: 'deepseek',
      model: 'fake-v2',
      code: 'schema_invalid',
      status: null,
    })
    expect(warning).toHaveBeenNthCalledWith(2, {
      provider: 'deepseek',
      model: 'fake-v2',
      code: 'schema_invalid',
      status: null,
    })
    warning.mockRestore()
  })

  it('retries a structure-only response and accepts all required sections from the second call', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const complete = vi
      .fn<V2ContentDetectorProvider['complete']>()
      .mockResolvedValueOnce(
        JSON.stringify({ version: V2_CONTENT_DETECTOR_VERSION, structure: structure() }),
      )
      .mockResolvedValueOnce(response())

    const result = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: TRANSCRIPT,
    })

    expect(result.status).toBe('checked')
    expect(result.calls).toBe(2)
    expect(result.categories.structure.status).toBe('checked')
    expect(result.categories.grammar.status).toBe('checked')
    expect(result.categories.vocabulary.status).toBe('checked')
    expect(complete).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith({
      provider: 'deepseek',
      model: 'fake-v2',
      code: 'schema_invalid',
      status: null,
    })
    warning.mockRestore()
  })

  it('retries partial content instead of silently accepting missing grammar and vocabulary', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const partial = JSON.stringify({
      version: V2_CONTENT_DETECTOR_VERSION,
      structure: structure(),
    })
    const complete = vi.fn<V2ContentDetectorProvider['complete']>().mockResolvedValue(partial)

    const result = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: TRANSCRIPT,
    })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result.calls).toBe(2)
    expect(result.status).toBe('checked')
    expect(result.categories).toMatchObject({
      structure: { status: 'checked', warnings: [] },
      grammar: {
        status: 'not_checked',
        component: null,
        warnings: ['grammar was missing'],
      },
      vocabulary: {
        status: 'not_checked',
        component: null,
        warnings: ['vocabulary was missing'],
      },
    })
    expect(result.warnings).toEqual(['grammar was missing', 'vocabulary was missing'])
    expect(warning).toHaveBeenCalledTimes(2)
    expect(warning.mock.calls.map(([diagnostic]) => diagnostic)).toEqual([
      {
        provider: 'deepseek',
        model: 'fake-v2',
        code: 'schema_invalid',
        status: null,
      },
      {
        provider: 'deepseek',
        model: 'fake-v2',
        code: 'schema_invalid',
        status: null,
      },
    ])
    warning.mockRestore()
  })

  it('retries when structure alone is missing and classifies the first response as schema-invalid', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const withoutStructure = JSON.stringify({
      version: V2_CONTENT_DETECTOR_VERSION,
      grammar: { findings: [] },
      vocabulary: { findings: [] },
    })
    const complete = vi
      .fn<V2ContentDetectorProvider['complete']>()
      .mockResolvedValueOnce(withoutStructure)
      .mockResolvedValueOnce(response())

    const result = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: TRANSCRIPT,
    })

    expect(result.calls).toBe(2)
    expect(result.categories.structure.status).toBe('checked')
    expect(complete).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledWith({
      provider: 'deepseek',
      model: 'fake-v2',
      code: 'schema_invalid',
      status: null,
    })
    expect(() => parseV2ContentResponse(withoutStructure, { transcript: TRANSCRIPT })).toThrowError(
      expect.objectContaining({
        code: 'schema_invalid',
        missingSections: ['structure'],
      }),
    )
    warning.mockRestore()
  })

  it('keeps partial-response diagnostics bounded and excludes private provider inputs', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const partial = JSON.stringify({
      version: V2_CONTENT_DETECTOR_VERSION,
      structure: structure(),
      ignored_provider_body: 'PRIVATE_PROVIDER_BODY_SENTINEL',
    })
    const complete = vi.fn<V2ContentDetectorProvider['complete']>().mockResolvedValue(partial)

    const result = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'PRIVATE_PROMPT_SENTINEL',
      transcript: 'PRIVATE_TRANSCRIPT_SENTINEL',
    })

    expect(result.warnings).toEqual(['grammar was missing', 'vocabulary was missing'])
    expect(warning).toHaveBeenCalledTimes(2)
    const logged = JSON.stringify(warning.mock.calls)
    expect(logged).not.toContain('PRIVATE_PROMPT_SENTINEL')
    expect(logged).not.toContain('PRIVATE_TRANSCRIPT_SENTINEL')
    expect(logged).not.toContain('PRIVATE_PROVIDER_BODY_SENTINEL')
    expect(logged).not.toContain(partial)
    warning.mockRestore()
  })

  it('does not retry provider outages', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
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
    expect(result.warnings).toEqual(['The content provider was unavailable.'])
    expect(complete).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith({
      provider: 'deepseek',
      model: 'fake-v2',
      code: 'unknown_provider_failure',
      status: null,
    })
    warning.mockRestore()
  })

  it('does not call a provider for an empty prompt or transcript', async () => {
    const complete = vi.fn<V2ContentDetectorProvider['complete']>().mockResolvedValue(response())
    const blankPrompt = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: '  ',
      transcript: TRANSCRIPT,
    })
    const blankTranscript = await runV2ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a park.',
      transcript: ' ',
    })
    expect(blankPrompt).toMatchObject({ status: 'not_checked', calls: 0 })
    expect(blankTranscript).toMatchObject({ status: 'not_checked', calls: 0 })
    expect(complete).not.toHaveBeenCalled()
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

  it('describes the exact keyed, versioned response schema the parser requires', () => {
    const user = JSON.parse(
      buildV2ContentUserPrompt({
        version: V2_CONTENT_DETECTOR_VERSION,
        mode: 'practice',
        prompt: 'Describe a park.',
        transcript: TRANSCRIPT,
      }),
    ) as { response_shape: { version: string; structure: { checks: Record<string, unknown> } } }
    expect(user.response_shape.version).toBe(V2_CONTENT_DETECTOR_VERSION)
    expect(user.response_shape.structure.checks.main_point).toMatchObject({
      passed: false,
      observation: expect.any(String),
      suggestion: expect.any(String),
    })
    expect(user.response_shape.structure.checks.answered_prompt).toMatchObject({
      passed: true,
      severity: null,
      quote: null,
      observation: null,
      suggestion: null,
    })
  })

  it('instructs precision without vocabulary-level or stylistic penalties', () => {
    expect(V2_CONTENT_SYSTEM_PROMPT).toMatch(/never penalize stylistic preference/i)
    expect(V2_CONTENT_SYSTEM_PROMPT).toMatch(/not fancy words or vocabulary level/i)
    expect(V2_CONTENT_SYSTEM_PROMPT).toMatch(/fillers, false starts, or closers/i)
  })

  it('explicitly forbids returning the requested schema inside an outer wrapper', () => {
    expect(V2_CONTENT_SYSTEM_PROMPT).toMatch(
      /do not return response_shape, response, result, analysis, or any other outer wrapper/i,
    )
  })
})
