import { CONTENT_PROVIDER_UNAVAILABLE_MESSAGE, type ContentModel } from '@/lib/deepseek/provider'
import {
  V3_CONTENT_EVALUATOR_VERSION,
  type V3ContentEvaluatorProvider,
} from '@/lib/scoring/v3/content/contracts'
import { v3ContentEvaluatorFromModel } from '@/lib/scoring/v3/content/adapter'
import {
  parseV3ContentResponse,
  runV3ContentEvaluation,
  V3ContentParseError,
} from '@/lib/scoring/v3/content/evaluate'
import { buildV3ContentUserPrompt, V3_CONTENT_SYSTEM_PROMPT } from '@/lib/scoring/v3/content/prompt'
import { WHAT_YOU_SAID_METRICS } from '@/lib/scoring/v3/contracts'
import { describe, expect, it, vi } from 'vitest'

const TRANSCRIPT = 'Um I led the launch. The result was clear and useful.'

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
    observation: 'This phrase shows the issue.',
    suggestion: 'Use a specific alternative.',
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

describe('v3 content evaluator contract', () => {
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

  it('rejects low-confidence, mechanically owned, and cross-metric reused evidence', () => {
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
          mechanicallyOwned: [{ start, end: start + 6, text: 'useful', category: 'filler' }],
        },
      ),
    ).toThrow(/mechanically owned speech/)

    expect(() =>
      parseV3ContentResponse(
        response({
          word_choice: metric({ component: 0.8, findings: [vague] }),
          grammar: metric({
            component: 0.8,
            findings: [finding('grammatical_error', 'useful')],
          }),
        }),
        { transcript: TRANSCRIPT },
      ),
    ).toThrow(/owned by another metric/)
  })

  it('assigns fillers, false starts, and closers only to Conciseness', () => {
    const parsed = parseV3ContentResponse(response(), {
      transcript: TRANSCRIPT,
      mechanicallyOwned: [
        { start: 0, end: 2, text: 'Um', category: 'filler' },
        { start: 3, end: 8, text: 'I led', category: 'false_start' },
      ],
    })
    expect(parsed.metrics.conciseness.component).toBe(0.91)
    expect(parsed.metrics.conciseness.measurements).toMatchObject({
      semantic_component: 1,
      filler_count: 1,
      false_start_count: 1,
      closer_count: 0,
      mechanical_component_reduction: 0.09,
    })
    expect(parsed.metrics.conciseness.details.map((detail) => detail.kind)).toEqual([
      'filler',
      'false_start',
    ])
    for (const metric of WHAT_YOU_SAID_METRICS.filter((name) => name !== 'conciseness')) {
      expect(parsed.metrics[metric].details).toEqual([])
    }
  })

  it('ignores invalid or overlapping local mechanical spans instead of charging twice', () => {
    const parsed = parseV3ContentResponse(response(), {
      transcript: TRANSCRIPT,
      mechanicallyOwned: [
        { start: 0, end: 2, text: 'Um', category: 'filler' },
        { start: 0, end: 4, text: 'Um I', category: 'false_start' },
        { start: 500, end: 502, text: 'Um', category: 'filler' },
      ],
    })
    expect(parsed.metrics.conciseness.component).toBe(0.97)
    expect(parsed.metrics.conciseness.details).toHaveLength(1)
  })

  it('does not charge mechanically detected speech when its transcription is unreliable', () => {
    const parsed = parseV3ContentResponse(response(), {
      transcript: TRANSCRIPT,
      mechanicallyOwned: [{ start: 0, end: 2, text: 'Um', category: 'filler' }],
      unreliableTranscriptSpans: [{ start: 0, end: 2, confidence: 0.2 }],
    })
    expect(parsed.metrics.conciseness.component).toBe(1)
    expect(parsed.metrics.conciseness.details).toEqual([])
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
    expect(evaluated.warnings).toEqual([CONTENT_PROVIDER_UNAVAILABLE_MESSAGE])
    expect(Object.values(evaluated.metrics).every((metric) => metric.component === null)).toBe(true)
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
    expect(request?.system).not.toContain('executive presence')
  })
})
