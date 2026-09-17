import { ContentProviderFailure, type ContentModel } from '@/lib/deepseek/provider'
import { assembleV3Score } from '@/lib/scoring/v3/assemble'
import {
  V3_CONTENT_EVALUATOR_VERSION,
  type V3ContentEvaluatorProvider,
  type V3MechanicallyOwnedSpan,
} from '@/lib/scoring/v3/content/contracts'
import { v3ContentEvaluatorFromModel } from '@/lib/scoring/v3/content/adapter'
import {
  parseV3ContentResponse,
  runV3ContentEvaluation,
  V3_CONTENT_CHECK_INVALID_MESSAGE,
  V3_CONTENT_CHECK_UNAVAILABLE_MESSAGE,
  V3ContentParseError,
} from '@/lib/scoring/v3/content/evaluate'
import { v3ContentEvidenceInput } from '@/lib/scoring/v3/content/input'
import { buildV3ContentUserPrompt, V3_CONTENT_SYSTEM_PROMPT } from '@/lib/scoring/v3/content/prompt'
import { WHAT_YOU_SAID_METRICS } from '@/lib/scoring/v3/contracts'
import { describe, expect, it, vi } from 'vitest'
import { wordsFrom } from './helpers/transcript'
import { v3Snapshot } from './helpers/result-snapshots'

const TRANSCRIPT = 'Um I led the launch. The result was clear and useful.'
const REAL_ATTEMPT_TRANSCRIPT =
  "One place I really like to spend time in is my car. I really like my car because it has a great speaker, and so I can play music. It's a quiet place where I could think. I also just like driving a lot, find it very fun, and that's about it."
const CURRENT_ATTEMPT_PROMPT =
  'Describe a place where you like to spend time. Include two details someone could picture.'
const CURRENT_ATTEMPT_TRANSCRIPT =
  "Um, I'd say a place that I really like to spend time, it's a little bit cliche, but it's just my room. Spent a lot of time in my room relaxing, but also doing work. I have my desk, and I have my monitor and my laptop and my bed. Specifically, my laptop and monitor helped me get a lot of work done. And it's here that I'm able to focus, but I also can relax and have some personal time to myself."
const CURRENT_UNRELIABLE_SPANS = [
  { start: 48, end: 53, confidence: 0.74780273 },
  { start: 103, end: 108, confidence: 0.6925049 },
  { start: 217, end: 220, confidence: 0.59472656 },
  { start: 265, end: 271, confidence: 0.70214844 },
]

function metric(overrides: Record<string, unknown> = {}) {
  return { component: 1, explanation: 'You complete this metric.', findings: [], ...overrides }
}

function finding(
  kind: string,
  quote: string | null,
  transcript = TRANSCRIPT,
): Record<string, unknown> {
  const start = quote === null ? null : transcript.indexOf(quote)
  return {
    kind,
    quote,
    start,
    end: quote === null ? null : (start as number) + quote.length,
    occurrence: quote === null ? null : 1,
    supporting_spans: [],
    observation: 'This phrase shows the issue.',
    suggestion: 'Use a specific alternative.',
  }
}

function repeatedIdeaFinding(transcript: string, quotes: readonly [string, string]) {
  return {
    ...finding('repeated_idea', null, transcript),
    supporting_spans: quotes.map((quote) => ({
      quote,
      start: transcript.indexOf(quote),
      end: transcript.indexOf(quote) + quote.length,
      occurrence: 1,
    })),
  }
}

function response(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: V3_CONTENT_EVALUATOR_VERSION,
    metrics: {
      answered_prompt: metric(),
      specificity: metric(),
      structure: metric(),
      conciseness: metric(),
      word_choice: metric(),
      grammar: metric(),
      ...overrides,
    },
  })
}

function provider(complete: V3ContentEvaluatorProvider['complete']): V3ContentEvaluatorProvider {
  return { name: 'fake-v3', complete }
}

async function evaluateTranscript(transcript: string, conciseness: ReturnType<typeof metric>) {
  const complete = vi.fn().mockResolvedValue(response({ conciseness }))
  const evidenceInput = v3ContentEvidenceInput(transcript, wordsFrom(transcript))
  const evaluated = await runV3ContentEvaluation({
    provider: provider(complete),
    mode: 'practice',
    prompt: 'Describe your role.',
    transcript,
    ...evidenceInput,
  })
  return { complete, evaluated, evidenceInput }
}

describe('v3 content evaluator contract', () => {
  it('recovers this attempt when a valid Conciseness finding initially crosses unreliable text', async () => {
    const cliche = finding('filler', "it's a little bit cliche, but", CURRENT_ATTEMPT_TRANSCRIPT)
    const unsafeSentence = finding(
      'redundant_sentence',
      'Spent a lot of time in my room relaxing, but also doing work.',
      CURRENT_ATTEMPT_TRANSCRIPT,
    )
    const safeSentence = finding(
      'redundant_sentence',
      'a lot of time in my room relaxing, but also doing work.',
      CURRENT_ATTEMPT_TRANSCRIPT,
    )
    const conciseness = (sentence: Record<string, unknown>) =>
      metric({
        component: 0.7,
        explanation: 'You use two filler phrases and repeat one point about your room.',
        findings: [finding('filler', 'Um', CURRENT_ATTEMPT_TRANSCRIPT), cliche, sentence],
      })
    const complete = vi
      .fn()
      .mockResolvedValueOnce(response({ conciseness: conciseness(unsafeSentence) }))
      .mockResolvedValueOnce(response({ conciseness: conciseness(safeSentence) }))

    const evaluated = await runV3ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: CURRENT_ATTEMPT_PROMPT,
      transcript: CURRENT_ATTEMPT_TRANSCRIPT,
      mechanicallyOwned: [],
      unreliableTranscriptSpans: CURRENT_UNRELIABLE_SPANS,
    })

    expect(evaluated.status).toBe('checked')
    expect(evaluated.calls).toBe(2)
    expect(complete.mock.calls[1]?.[0].retryInstruction).toContain(
      'overlapped unreliable transcript text',
    )
    expect(complete.mock.calls[1]?.[0].retryInstruction).toContain('"Spent"')
    expect(Object.values(evaluated.metrics).every((result) => result.status === 'scored')).toBe(
      true,
    )
    expect(evaluated.metrics.conciseness.evidence.map((item) => item.quote)).toEqual([
      'Um',
      "it's a little bit cliche, but",
      'a lot of time in my room relaxing, but also doing work.',
    ])

    const assembled = assembleV3Score({
      mode: 'practice',
      content: evaluated,
      sounded: v3Snapshot({ component: 0.8 }).sections.how_you_sounded.metrics,
    })
    expect(assembled.sections.what_you_said.earned_points).toBe(48)
    expect(assembled.total_earned_points).toBe(88)
  })

  it('omits an unsafe deduction after the retry without discarding the other metrics', async () => {
    const unsafe = response({
      conciseness: metric({
        component: 0.8,
        explanation: 'You repeat one point about your room.',
        findings: [
          finding(
            'redundant_sentence',
            'Spent a lot of time in my room relaxing, but also doing work.',
            CURRENT_ATTEMPT_TRANSCRIPT,
          ),
        ],
      }),
    })
    const complete = vi.fn().mockResolvedValue(unsafe)
    const evaluated = await runV3ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: CURRENT_ATTEMPT_PROMPT,
      transcript: CURRENT_ATTEMPT_TRANSCRIPT,
      mechanicallyOwned: [],
      unreliableTranscriptSpans: CURRENT_UNRELIABLE_SPANS,
    })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(evaluated.status).toBe('checked')
    expect(evaluated.metrics.conciseness).toMatchObject({
      status: 'scored',
      component: 1,
      explanation: 'No reliable issue was counted for this metric.',
    })
    expect(Object.values(evaluated.metrics).every((result) => result.status === 'scored')).toBe(
      true,
    )
    const assembled = assembleV3Score({
      mode: 'practice',
      content: evaluated,
      sounded: v3Snapshot({ component: 0.8 }).sections.how_you_sounded.metrics,
    })
    expect(assembled.sections.what_you_said.earned_points).toBe(50)
    expect(assembled.total_earned_points).toBe(90)
  })

  it('keeps the other content scores when Word Choice repeatedly cites an unreliable word', async () => {
    const transcript = 'We planned a vacation.'
    const vacationStart = transcript.indexOf('vacation')
    const unsafe = response({
      word_choice: metric({
        component: 0.6,
        explanation: 'Your wording could be more precise.',
        findings: [finding('imprecise_wording', 'vacation', transcript)],
      }),
    })
    const complete = vi.fn().mockResolvedValue(unsafe)

    const evaluated = await runV3ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe a changed plan.',
      transcript,
      unreliableTranscriptSpans: [
        { start: vacationStart, end: vacationStart + 'vacation'.length, confidence: 0.5 },
      ],
    })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(evaluated.status).toBe('checked')
    expect(evaluated.metrics.word_choice).toMatchObject({
      status: 'scored',
      component: 1,
      explanation: 'No reliable issue was counted for this metric.',
    })
    expect(Object.values(evaluated.metrics).every((result) => result.status === 'scored')).toBe(
      true,
    )
  })

  it('scores all six metrics for the real-attempt transcript shape', async () => {
    const complete = vi.fn().mockResolvedValue(response())
    const evaluated = await runV3ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt:
        'Describe a place where you like to spend time. Include two details someone could picture.',
      transcript: REAL_ATTEMPT_TRANSCRIPT,
      ...v3ContentEvidenceInput(REAL_ATTEMPT_TRANSCRIPT, wordsFrom(REAL_ATTEMPT_TRANSCRIPT)),
    })

    expect(evaluated.status).toBe('checked')
    expect(Object.values(evaluated.metrics)).toHaveLength(6)
    expect(Object.values(evaluated.metrics).every((result) => result.status === 'scored')).toBe(
      true,
    )
  })

  it('returns exactly six normalized What You Said metrics', () => {
    const parsed = parseV3ContentResponse(
      response({
        specificity: metric({
          component: 0.65,
          explanation: 'You name the work but not its measurable outcome.',
          findings: [finding('missing_outcome', null)],
        }),
        word_choice: metric({
          component: 0.8,
          explanation: 'You use one broad word.',
          findings: [finding('vague_wording', 'useful')],
        }),
      }),
      { transcript: TRANSCRIPT },
    )

    expect(Object.keys(parsed.metrics)).toEqual(expect.arrayContaining([...WHAT_YOU_SAID_METRICS]))
    expect(Object.keys(parsed.metrics)).toHaveLength(6)
    expect(parsed.metrics.specificity.component).toBe(0.65)
    expect(parsed.metrics.word_choice.evidence[0]).toMatchObject({
      coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
      quote: 'useful',
    })
  })

  it('uses JavaScript UTF-16 coordinates exactly', () => {
    const transcript = 'I used 😀 stuff.'
    const parsed = parseV3ContentResponse(
      response({
        word_choice: metric({
          component: 0.8,
          explanation: 'You use one vague noun.',
          findings: [finding('vague_wording', 'stuff', transcript)],
        }),
      }),
      { transcript },
    )
    expect(parsed.metrics.word_choice.evidence[0]).toMatchObject({ start: 10, end: 15 })
  })

  it('repairs incorrect offsets only when the exact quote is unique', () => {
    const parsed = parseV3ContentResponse(
      response({
        word_choice: metric({
          component: 0.8,
          explanation: 'You use one broad word.',
          findings: [
            {
              ...finding('vague_wording', 'useful'),
              start: 0,
              end: 6,
            },
          ],
        }),
      }),
      { transcript: TRANSCRIPT },
    )

    expect(parsed.metrics.word_choice.evidence[0]).toMatchObject({
      start: TRANSCRIPT.indexOf('useful'),
      end: TRANSCRIPT.indexOf('useful') + 'useful'.length,
      quote: 'useful',
    })
  })

  it('rejects offset repair when the quote is ambiguous', () => {
    const transcript = 'work can clarify work.'
    const ambiguousFinding = finding('vague_wording', 'work', transcript)
    delete ambiguousFinding.occurrence
    try {
      parseV3ContentResponse(
        response({
          word_choice: metric({
            component: 0.8,
            explanation: 'You repeat one broad word.',
            findings: [
              {
                ...ambiguousFinding,
                start: 2,
                end: 6,
              },
            ],
          }),
        }),
        { transcript },
      )
      expect.unreachable('Expected ambiguous evidence to fail closed.')
    } catch (error) {
      expect(error).toMatchObject({ reason: 'ambiguous_evidence', metric: 'word_choice' })
    }
  })

  it('uses an explicit occurrence to repair an ambiguous quote without guessing', () => {
    const transcript = 'work can clarify work.'
    const parsed = parseV3ContentResponse(
      response({
        word_choice: metric({
          component: 0.8,
          explanation: 'You use one broad word.',
          findings: [
            {
              ...finding('vague_wording', 'work', transcript),
              start: 0,
              end: 0,
              occurrence: 2,
            },
          ],
        }),
      }),
      { transcript },
    )

    expect(parsed.metrics.word_choice.evidence[0]).toMatchObject({ start: 17, end: 21 })
  })

  it('rejects a malformed occurrence even when the quote and offsets match', () => {
    expect(() =>
      parseV3ContentResponse(
        response({
          word_choice: metric({
            component: 0.8,
            findings: [{ ...finding('vague_wording', 'useful'), occurrence: 0 }],
          }),
        }),
        { transcript: TRANSCRIPT },
      ),
    ).toThrow(/invalid occurrence/)

    expect(() =>
      parseV3ContentResponse(
        response({
          word_choice: metric({
            component: 0.8,
            findings: [
              {
                ...finding('vague_wording', 'useful'),
                start: 0,
                end: 0,
                occurrence: 2,
              },
            ],
          }),
        }),
        { transcript: TRANSCRIPT },
      ),
    ).toThrow(/locators were inconsistent/)
  })

  it('allows response-level repetition without a fabricated contiguous quote', () => {
    const parsed = parseV3ContentResponse(
      response({
        conciseness: metric({
          component: 0.8,
          explanation: 'You repeat the same idea in separate sentences.',
          findings: [finding('repeated_idea', null)],
        }),
      }),
      { transcript: TRANSCRIPT },
    )

    expect(parsed.metrics.conciseness.details[0]).toMatchObject({
      kind: 'repeated_idea',
      quote: null,
      evidence: [],
    })
  })

  it('normalizes separate exact spans for one repeated idea', () => {
    const first = 'One place I really like to spend time in is my car.'
    const second = 'I really like my car because it has a great speaker'
    const parsed = parseV3ContentResponse(
      response({
        conciseness: metric({
          component: 0.82,
          explanation: 'You repeat that you like your car.',
          findings: [repeatedIdeaFinding(REAL_ATTEMPT_TRANSCRIPT, [first, second])],
        }),
      }),
      { transcript: REAL_ATTEMPT_TRANSCRIPT },
    )

    expect(parsed.metrics.conciseness.details[0]).toMatchObject({
      kind: 'repeated_idea',
      quote: null,
    })
    expect(parsed.metrics.conciseness.details[0]?.evidence.map((item) => item.quote)).toEqual([
      first,
      second,
    ])
  })

  it('rejects whole-response filler evidence and invented supporting spans', () => {
    expect(() =>
      parseV3ContentResponse(
        response({
          conciseness: metric({
            component: 0.8,
            findings: [finding('filler', null)],
          }),
        }),
        { transcript: TRANSCRIPT },
      ),
    ).toThrow(/invalid whole-response evidence/)

    const repeated = repeatedIdeaFinding(REAL_ATTEMPT_TRANSCRIPT, [
      'One place I really like to spend time in is my car.',
      'I really like my car because it has a great speaker',
    ])
    repeated.supporting_spans[1] = {
      quote: 'invented supporting text',
      start: 0,
      end: 24,
      occurrence: 1,
    }
    expect(() =>
      parseV3ContentResponse(
        response({
          conciseness: metric({ component: 0.8, findings: [repeated] }),
        }),
        { transcript: REAL_ATTEMPT_TRANSCRIPT },
      ),
    ).toThrow(/did not match the transcript/)
  })

  it.each([
    ['missing metric', JSON.stringify({ version: V3_CONTENT_EVALUATOR_VERSION, metrics: {} })],
    ['extra metric', response({ hidden_quality: metric() })],
    ['unsupported version', response().replace(V3_CONTENT_EVALUATOR_VERSION, 'future')],
    [
      'component without evidence',
      response({ word_choice: metric({ component: 0.5, findings: [] }) }),
    ],
  ])('rejects a %s and fails the whole content evaluation closed', (_label, raw) => {
    expect(() => parseV3ContentResponse(raw, { transcript: TRANSCRIPT })).toThrow(
      V3ContentParseError,
    )
  })

  it('rejects unsafe evidence and omits a later metric deduction that reuses a span', () => {
    const vague = finding('vague_wording', 'useful')
    const start = TRANSCRIPT.indexOf('useful')
    expect(() =>
      parseV3ContentResponse(
        response({
          word_choice: metric({ component: 0.8, findings: [vague] }),
        }),
        {
          transcript: TRANSCRIPT,
          unreliableTranscriptSpans: [{ start, end: start + 6, confidence: 0.2 }],
        },
      ),
    ).toThrow(/unreliable transcription/)

    expect(() =>
      parseV3ContentResponse(
        response({
          word_choice: metric({ component: 0.8, findings: [vague] }),
        }),
        {
          transcript: TRANSCRIPT,
          mechanicallyOwned: [{ start, end: start + 6, text: 'useful', category: 'false_start' }],
        },
      ),
    ).toThrow(/mechanically owned speech/)

    const parsed = parseV3ContentResponse(
      response({
        word_choice: metric({ component: 0.8, findings: [vague] }),
        grammar: metric({
          component: 0.8,
          findings: [finding('grammatical_error', 'useful')],
        }),
      }),
      { transcript: TRANSCRIPT },
    )
    expect(parsed.metrics.grammar).toMatchObject({ component: 0.8 })
    expect(parsed.metrics.word_choice).toMatchObject({
      component: 1,
      details: [],
      evidence: [],
    })
  })

  it('ignores invalid or overlapping structural spans instead of charging twice', () => {
    const parsed = parseV3ContentResponse(response(), {
      transcript: TRANSCRIPT,
      mechanicallyOwned: [
        { start: 0, end: 4, text: 'Um I', category: 'false_start' },
        { start: 0, end: 2, text: 'Um', category: 'false_start' },
        { start: 500, end: 502, text: 'Um', category: 'false_start' },
      ],
    })
    expect(parsed.metrics.conciseness.component).toBe(0.94)
    expect(parsed.metrics.conciseness.details).toHaveLength(1)
  })

  it('does not charge a structural span when its transcription is unreliable', () => {
    const parsed = parseV3ContentResponse(response(), {
      transcript: TRANSCRIPT,
      mechanicallyOwned: [{ start: 0, end: 2, text: 'Um', category: 'false_start' }],
      unreliableTranscriptSpans: [{ start: 0, end: 2, confidence: 0.2 }],
    })
    expect(parsed.metrics.conciseness.component).toBe(1)
    expect(parsed.metrics.conciseness.details).toEqual([])
  })

  describe('context-aware filler ownership', () => {
    it('accepts an AI-owned um filler with validated transcript evidence', async () => {
      const transcript = 'Um, I led the launch.'
      const { evaluated } = await evaluateTranscript(
        transcript,
        metric({
          component: 0.82,
          explanation: 'You open with unnecessary filler.',
          findings: [finding('filler', 'Um,', transcript)],
        }),
      )

      expect(evaluated.metrics.conciseness).toMatchObject({
        component: 0.82,
        measurements: {},
      })
      expect(evaluated.metrics.conciseness.details[0]).toMatchObject({
        kind: 'filler',
        source: 'ai',
        quote: 'Um,',
      })
    })

    it('penalizes like only when the provider identifies its contextual use as filler', async () => {
      const transcript = 'I handled, like, five launches.'
      const { evaluated, evidenceInput } = await evaluateTranscript(
        transcript,
        metric({
          component: 0.8,
          explanation: 'You insert one unnecessary filler.',
          findings: [finding('filler', 'like,', transcript)],
        }),
      )

      expect(evidenceInput.mechanicallyOwned).toEqual([])
      expect(evaluated.metrics.conciseness.component).toBe(0.8)
      expect(evaluated.metrics.conciseness.evidence[0]?.quote).toBe('like,')
    })

    it('does not automatically penalize a meaningful use of like', async () => {
      const transcript = 'I like the approach because it reduces errors.'
      const { evaluated, evidenceInput } = await evaluateTranscript(transcript, metric())

      expect(evidenceInput.mechanicallyOwned).toEqual([])
      expect(evaluated.metrics.conciseness).toMatchObject({
        component: 1,
        measurements: {},
        details: [],
      })
    })

    it('does not automatically penalize a meaningful use of honestly', async () => {
      const transcript = 'I honestly reported the delay as soon as I found it.'
      const { evaluated, evidenceInput } = await evaluateTranscript(transcript, metric())

      expect(evidenceInput.mechanicallyOwned).toEqual([])
      expect(evaluated.metrics.conciseness.component).toBe(1)
      expect(evaluated.metrics.conciseness.details).toEqual([])
    })

    it('accepts a niche filler phrase without adding it to a dictionary', async () => {
      const transcript = 'The thing is, I led the launch.'
      const { evaluated, evidenceInput } = await evaluateTranscript(
        transcript,
        metric({
          component: 0.76,
          explanation: 'You use a phrase that adds no useful meaning here.',
          findings: [finding('filler', 'The thing is,', transcript)],
        }),
      )

      expect(evidenceInput.mechanicallyOwned).toEqual([])
      expect(evaluated.metrics.conciseness.component).toBe(0.76)
      expect(evaluated.metrics.conciseness.details[0]?.kind).toBe('filler')
    })

    it('accepts a closer as contextual filler without hardcoding it', async () => {
      const { evaluated, evidenceInput } = await evaluateTranscript(
        REAL_ATTEMPT_TRANSCRIPT,
        metric({
          component: 0.86,
          explanation: 'You end with a phrase that adds no useful meaning here.',
          findings: [finding('filler', "and that's about it", REAL_ATTEMPT_TRANSCRIPT)],
        }),
      )

      expect(evidenceInput.mechanicallyOwned).toEqual([])
      expect(evaluated.metrics.conciseness).toMatchObject({
        component: 0.86,
        measurements: {},
      })
      expect(evaluated.metrics.conciseness.evidence[0]?.quote).toBe("and that's about it")
    })

    it('keeps just and meaningful uses of like uncharged unless the model finds an issue', async () => {
      const { evaluated, evidenceInput } = await evaluateTranscript(
        REAL_ATTEMPT_TRANSCRIPT,
        metric(),
      )

      expect(evidenceInput.mechanicallyOwned).toEqual([])
      expect(evaluated.metrics.conciseness).toMatchObject({
        component: 1,
        measurements: {},
        details: [],
      })
    })

    it('assigns a filler finding only to Conciseness', async () => {
      const transcript = 'Um, I led the launch.'
      const { evaluated } = await evaluateTranscript(
        transcript,
        metric({
          component: 0.82,
          explanation: 'You open with unnecessary filler.',
          findings: [finding('filler', 'Um,', transcript)],
        }),
      )

      for (const name of WHAT_YOU_SAID_METRICS.filter(
        (metricName) => metricName !== 'conciseness',
      )) {
        expect(evaluated.metrics[name]).toMatchObject({ component: 1, details: [] })
      }
    })

    it('does not mechanically subtract the same filler span', async () => {
      const transcript = 'Um, I led the launch.'
      const { evaluated, evidenceInput } = await evaluateTranscript(
        transcript,
        metric({
          component: 0.82,
          explanation: 'You open with unnecessary filler.',
          findings: [finding('filler', 'Um,', transcript)],
        }),
      )

      expect(evidenceInput.mechanicallyOwned).toEqual([])
      expect(evaluated.metrics.conciseness.component).toBe(0.82)
      expect(evaluated.metrics.conciseness.details).toHaveLength(1)
      expect(evaluated.metrics.conciseness.measurements).not.toHaveProperty(
        'structural_component_reduction',
      )

      const staleMechanicalFiller = [
        { start: 0, end: 3, text: 'Um,', category: 'filler' },
      ] as unknown as V3MechanicallyOwnedSpan[]
      const parsed = parseV3ContentResponse(
        response({
          conciseness: metric({
            component: 0.82,
            explanation: 'You open with unnecessary filler.',
            findings: [finding('filler', 'Um,', transcript)],
          }),
        }),
        { transcript, mechanicallyOwned: staleMechanicalFiller },
      )
      expect(parsed.metrics.conciseness.component).toBe(0.82)
      expect(parsed.metrics.conciseness.details).toHaveLength(1)
    })

    it('retains a separate deterministic false-start deduction', async () => {
      const transcript = 'I, I answered the prompt.'
      const { evaluated, evidenceInput } = await evaluateTranscript(transcript, metric())

      expect(evidenceInput.mechanicallyOwned).toEqual([
        { start: 0, end: 2, text: 'I,', category: 'false_start' },
      ])
      expect(evaluated.metrics.conciseness).toMatchObject({
        component: 0.94,
        measurements: {
          semantic_component: 1,
          structural_component_reduction: 0.06,
        },
      })
      expect(evaluated.metrics.conciseness.details[0]).toMatchObject({
        kind: 'false_start',
        source: 'mechanical',
      })
    })

    it('rejects invented filler evidence and fails the content evaluation closed', async () => {
      const complete = vi.fn().mockResolvedValue(
        response({
          conciseness: metric({
            component: 0.7,
            explanation: 'You use unnecessary filler.',
            findings: [finding('filler', 'invented')],
          }),
        }),
      )
      const evaluated = await runV3ContentEvaluation({
        provider: provider(complete),
        mode: 'practice',
        prompt: 'Describe your role.',
        transcript: TRANSCRIPT,
      })

      expect(complete).toHaveBeenCalledTimes(2)
      expect(evaluated.status).toBe('not_checked')
      expect(evaluated.diagnostic).toEqual({
        category: 'content_validation_failed',
        code: 'schema_invalid',
        reason: 'evidence_not_in_transcript',
        metric: 'conciseness',
      })
    })
  })

  it('retries once, then returns no usable metric when output remains malformed', async () => {
    const complete = vi.fn().mockResolvedValue(response({ grammar: undefined }))
    const evaluated = await runV3ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe your role.',
      transcript: TRANSCRIPT,
    })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(evaluated.status).toBe('not_checked')
    expect(evaluated.calls).toBe(2)
    expect(evaluated.warnings).toEqual([V3_CONTENT_CHECK_INVALID_MESSAGE])
    expect(evaluated.diagnostic).toMatchObject({
      category: 'provider_invalid_response',
      code: 'schema_invalid',
      reason: 'envelope_invalid',
    })
    expect(Object.values(evaluated.metrics).every((metric) => metric.component === null)).toBe(true)
  })

  it('classifies transcript-evidence rejection separately from provider availability', async () => {
    const complete = vi.fn().mockResolvedValue(
      response({
        word_choice: metric({
          component: 0.8,
          findings: [
            {
              ...finding('vague_wording', 'invented'),
              start: 0,
              end: 8,
            },
          ],
        }),
      }),
    )
    const evaluated = await runV3ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe your role.',
      transcript: TRANSCRIPT,
    })

    expect(evaluated.status).toBe('not_checked')
    expect(evaluated.diagnostic).toEqual({
      category: 'content_validation_failed',
      code: 'schema_invalid',
      reason: 'evidence_not_in_transcript',
      metric: 'word_choice',
    })
  })

  it('returns the complete second response after a malformed first response', async () => {
    const complete = vi.fn().mockResolvedValueOnce('{').mockResolvedValueOnce(response())
    const evaluated = await runV3ContentEvaluation({
      provider: provider(complete),
      mode: 'interview',
      prompt: 'Describe your role.',
      transcript: TRANSCRIPT,
    })
    expect(evaluated.status).toBe('checked')
    expect(evaluated.calls).toBe(2)
    expect(complete.mock.calls[1]?.[0].retryInstruction).toContain('failed validation')
  })

  it('uses outage copy only for an actual provider availability failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const complete = vi
      .fn<V3ContentEvaluatorProvider['complete']>()
      .mockRejectedValue(new ContentProviderFailure('timeout', 'test-model'))
    const evaluated = await runV3ContentEvaluation({
      provider: provider(complete),
      mode: 'practice',
      prompt: 'Describe your role.',
      transcript: TRANSCRIPT,
    })
    warn.mockRestore()

    expect(evaluated.status).toBe('not_checked')
    expect(evaluated.warnings).toEqual([V3_CONTENT_CHECK_UNAVAILABLE_MESSAGE])
    expect(evaluated.diagnostic).toMatchObject({
      category: 'provider_unavailable',
      code: 'timeout',
    })
  })

  it('keeps the adapter vendor-neutral and requests only visible content metrics', async () => {
    const complete = vi.fn<ContentModel['complete']>().mockResolvedValue(response())
    const adapter = v3ContentEvaluatorFromModel({ name: 'test-model', complete })
    await adapter.complete({
      version: V3_CONTENT_EVALUATOR_VERSION,
      mode: 'conversation',
      prompt: 'What happened?',
      transcript: TRANSCRIPT,
      mechanicallyOwned: [],
      unreliableTranscriptSpans: [],
    })
    const request = complete.mock.calls[0]?.[0]
    expect(request?.system).toBe(V3_CONTENT_SYSTEM_PROMPT)
    expect(request?.user).toBe(
      buildV3ContentUserPrompt({
        version: V3_CONTENT_EVALUATOR_VERSION,
        mode: 'conversation',
        prompt: 'What happened?',
        transcript: TRANSCRIPT,
        mechanicallyOwned: [],
        unreliableTranscriptSpans: [],
      }),
    )
    expect(request?.system).toContain('Score only these visible metrics')
    expect(request?.system).toContain('Do not assess delivery')
    expect(request?.system).toContain('filler words or phrases')
    expect(request?.system).toContain('not from a fixed vocabulary list')
    expect(request?.system).toContain('A word such as "like" or "honestly" is not a filler')
    expect(request?.system).toContain('Repeated wording is not filler')
    expect(request?.system).toContain('supporting_spans')
    const user = JSON.parse(request?.user ?? '{}') as {
      allowed_finding_kinds?: { conciseness?: unknown }
      response_shape?: {
        metrics?: { conciseness?: { findings?: Array<Record<string, unknown>> } }
      }
    }
    expect(user.allowed_finding_kinds?.conciseness).toContain('repeated_idea')
    expect(user.response_shape?.metrics?.conciseness?.findings?.[0]).toMatchObject({
      kind: 'filler',
      quote: 'exact transcript words',
      occurrence: 1,
      supporting_spans: [],
    })
    expect(request?.system).not.toContain('executive presence')
  })
})
