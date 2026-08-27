import { describe, expect, it, vi } from 'vitest'
import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'
import type { ContentModel } from '@/lib/deepseek/provider'
import {
  CONTENT_POINTS,
  applyDisputes,
  notCheckedContent,
  parseContentResponse,
  scoreContent,
  severityPoints,
  wordChoicePoints,
  ContentParseError,
} from '@/lib/scoring/content'
import { runContentCheck, runContentCheckSafely } from '@/lib/scoring/run-content'

const TRANSCRIPT =
  "I'd say New York is really cool. I feel like the food there is good, and I mean the food there is good."

function response(overrides: Record<string, unknown> = {}) {
  const pass = { passed: true, severity: null, quote: null, observation: null, suggestion: null }
  return JSON.stringify({
    checks: {
      answered: pass,
      explained: pass,
      logical_order: pass,
      no_repetition: pass,
      word_choice: pass,
    },
    extra_spans: [],
    tightened: TRANSCRIPT,
    ...overrides,
  })
}

const model = (complete: ContentModel['complete']): ContentModel => ({ name: 'fake', complete })

describe('parseContentResponse', () => {
  it('reads a clean response', () => {
    const parsed = parseContentResponse(response(), TRANSCRIPT)
    expect(parsed.checks.answered.passed).toBe(true)
    expect(parsed.extra_spans).toEqual([])
    expect(parsed.tightened).toBe(TRANSCRIPT)
    expect(parsed.dropped).toEqual([])
  })

  it('recovers JSON wrapped in prose or a fence', () => {
    const wrapped = '```json\n' + response() + '\n```'
    expect(parseContentResponse(wrapped, TRANSCRIPT).checks.answered.passed).toBe(true)
  })

  it('throws a typed error on unusable JSON', () => {
    expect(() => parseContentResponse('not json at all', TRANSCRIPT)).toThrow(ContentParseError)
    expect(() => parseContentResponse('{"nope": 1}', TRANSCRIPT)).toThrow(ContentParseError)
  })

  /** A finding that misquotes the speaker cannot be shown, so it cannot deduct. */
  it('drops a finding whose quote is not in the transcript', () => {
    const raw = response({
      checks: {
        answered: {
          passed: false,
          severity: 'clear',
          quote: 'something the speaker never said',
          observation: 'x',
          suggestion: null,
        },
        explained: {
          passed: true,
          severity: null,
          quote: null,
          observation: null,
          suggestion: null,
        },
        logical_order: {
          passed: true,
          severity: null,
          quote: null,
          observation: null,
          suggestion: null,
        },
        no_repetition: {
          passed: true,
          severity: null,
          quote: null,
          observation: null,
          suggestion: null,
        },
        word_choice: {
          passed: true,
          severity: null,
          quote: null,
          observation: null,
          suggestion: null,
        },
      },
    })
    const parsed = parseContentResponse(raw, TRANSCRIPT)
    expect(parsed.checks.answered.passed).toBe(true)
    expect(parsed.dropped.join(' ')).toMatch(/not in the transcript/)
    expect(scoreContent(parsed).points.answered).toBe(CONTENT_POINTS.answered)
  })

  it('keeps a finding whose quote is a real substring', () => {
    const raw = response({
      checks: {
        answered: {
          passed: true,
          severity: null,
          quote: null,
          observation: null,
          suggestion: null,
        },
        explained: {
          passed: false,
          severity: 'minor',
          quote: 'really cool',
          observation: 'No detail follows this.',
          suggestion: 'walkable',
        },
        logical_order: {
          passed: true,
          severity: null,
          quote: null,
          observation: null,
          suggestion: null,
        },
        no_repetition: {
          passed: true,
          severity: null,
          quote: null,
          observation: null,
          suggestion: null,
        },
        word_choice: {
          passed: true,
          severity: null,
          quote: null,
          observation: null,
          suggestion: null,
        },
      },
    })
    const parsed = parseContentResponse(raw, TRANSCRIPT)
    expect(parsed.checks.explained.passed).toBe(false)
    expect(parsed.checks.explained.severity).toBe('minor')
  })

  it('drops spans that are not substrings and keeps the ones that are', () => {
    const parsed = parseContentResponse(
      response({
        extra_spans: [
          { text: 'I feel like', category: 'padding' },
          { text: 'never uttered', category: 'padding' },
        ],
      }),
      TRANSCRIPT,
    )
    expect(parsed.extra_spans).toHaveLength(1)
    expect(parsed.extra_spans[0]?.text).toBe('I feel like')
  })

  it('caps extra spans at 8', () => {
    const parsed = parseContentResponse(
      response({
        extra_spans: Array.from({ length: 12 }, () => ({
          text: 'really cool',
          category: 'imprecise',
        })),
      }),
      TRANSCRIPT,
    )
    expect(parsed.extra_spans).toHaveLength(8)
    expect(parsed.dropped.join(' ')).toMatch(/truncated/)
  })

  it('falls back to padding for an unknown category', () => {
    const parsed = parseContentResponse(
      response({ extra_spans: [{ text: 'really cool', category: 'nonsense' }] }),
      TRANSCRIPT,
    )
    expect(parsed.extra_spans[0]?.category).toBe('padding')
  })

  /** A tightening, not a summary and not an expansion. */
  it('discards a rewrite that is too short', () => {
    const parsed = parseContentResponse(response({ tightened: 'New York is cool.' }), TRANSCRIPT)
    expect(parsed.tightened).toBeNull()
    expect(parsed.dropped.join(' ')).toMatch(/outside the 85 to 125/)
  })

  it('discards a rewrite that is too long', () => {
    const parsed = parseContentResponse(
      response({ tightened: `${TRANSCRIPT} ${TRANSCRIPT}` }),
      TRANSCRIPT,
    )
    expect(parsed.tightened).toBeNull()
  })

  it('keeps a rewrite inside the band when nothing was flagged', () => {
    // 23 words spoken and nothing flagged, so the rewrite should stay near 23.
    const trimmed =
      "I'd say New York is cool. I feel like the food there is good, and I mean the food there is good."
    const parsed = parseContentResponse(response({ tightened: trimmed }), TRANSCRIPT)
    expect(parsed.tightened).toBe(trimmed)
  })

  it('treats a missing check as passed', () => {
    const parsed = parseContentResponse(
      JSON.stringify({ checks: { answered: { passed: false, severity: 'clear', quote: null } } }),
      TRANSCRIPT,
    )
    expect(parsed.checks.explained.passed).toBe(true)
    expect(scoreContent(parsed).points.explained).toBe(CONTENT_POINTS.explained)
  })
})

describe('content scoring', () => {
  it('grades word choice by flagged span count', () => {
    expect(wordChoicePoints(0)).toBe(12)
    expect(wordChoicePoints(1)).toBe(9)
    expect(wordChoicePoints(2)).toBe(7)
    expect(wordChoicePoints(3)).toBe(5)
    expect(wordChoicePoints(4)).toBe(3)
    expect(wordChoicePoints(5)).toBe(0)
    expect(wordChoicePoints(11)).toBe(0)
  })

  it('gives minor 40 percent and clear nothing', () => {
    const finding = (severity: 'minor' | 'clear') => ({
      passed: false,
      severity,
      quote: null,
      observation: null,
      suggestion: null,
    })
    expect(severityPoints(14, finding('minor'))).toBe(6)
    expect(severityPoints(14, finding('clear'))).toBe(0)
    expect(severityPoints(12, finding('minor'))).toBe(5)
    expect(severityPoints(7, finding('minor'))).toBe(3)
  })

  it('awards every content point when the check never ran', () => {
    const score = scoreContent(notCheckedContent())
    expect(score.total).toBe(50)
    expect(score.points.answered).toBe(14)
    expect(score.points.word_choice).toBe(12)
  })
})

describe('disputes', () => {
  const failing = parseContentResponse(
    JSON.stringify({
      checks: {
        answered: {
          passed: false,
          severity: 'clear',
          quote: 'really cool',
          observation: 'x',
          suggestion: null,
        },
        explained: { passed: true },
        logical_order: { passed: true },
        no_repetition: { passed: true },
        word_choice: { passed: true },
      },
      extra_spans: [
        { text: 'I feel like', category: 'padding' },
        { text: 'really cool', category: 'imprecise' },
      ],
      tightened: null,
    }),
    TRANSCRIPT,
  )

  it('removes a disputed check deduction', () => {
    expect(scoreContent(failing).points.answered).toBe(0)
    const adjusted = applyDisputes(failing, [{ note_type: 'answered', quote: 'really cool' }])
    expect(scoreContent(adjusted).points.answered).toBe(14)
  })

  it('removes a disputed span from the word choice count', () => {
    expect(scoreContent(failing).points.word_choice).toBe(7)
    const adjusted = applyDisputes(failing, [
      { note_type: 'word_choice_span', quote: 'I feel like' },
    ])
    expect(scoreContent(adjusted).points.word_choice).toBe(9)
  })

  it('places no limit on how many findings may be disputed', () => {
    const adjusted = applyDisputes(failing, [
      { note_type: 'answered', quote: null },
      { note_type: 'word_choice_span', quote: 'I feel like' },
      { note_type: 'word_choice_span', quote: 'really cool' },
    ])
    const score = scoreContent(adjusted)
    expect(score.points.answered).toBe(14)
    expect(score.points.word_choice).toBe(12)
    expect(score.total).toBe(50)
  })
})

describe('runContentCheck', () => {
  const request = { system: 's', user: 'u', timeoutMs: 1000 }

  it('returns the parsed result on the first call', async () => {
    const outcome = await runContentCheck({
      model: model(async () => response()),
      request,
      transcript: TRANSCRIPT,
    })
    expect(outcome.parsed).not.toBeNull()
    expect(outcome.calls).toBe(1)
    expect(outcome.error).toBeNull()
  })

  it('retries once on malformed JSON and succeeds', async () => {
    const complete = vi
      .fn<ContentModel['complete']>()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(response())
    const outcome = await runContentCheck({
      model: model(complete),
      request,
      transcript: TRANSCRIPT,
    })
    expect(outcome.calls).toBe(2)
    expect(outcome.parsed).not.toBeNull()
  })

  it('gives up after a second malformed response without throwing', async () => {
    const outcome = await runContentCheck({
      model: model(async () => 'still not json'),
      request,
      transcript: TRANSCRIPT,
    })
    expect(outcome.calls).toBe(2)
    expect(outcome.parsed).toBeNull()
    expect(outcome.error).toMatch(/not JSON/)
  })

  /** A timeout will not improve by asking again. */
  it('does not retry a timeout, and never throws', async () => {
    const complete = vi
      .fn<ContentModel['complete']>()
      .mockRejectedValue(new RequestTimeoutError('Checking your content', 30_000))
    const outcome = await runContentCheck({
      model: model(complete),
      request,
      transcript: TRANSCRIPT,
    })
    expect(outcome.calls).toBe(1)
    expect(outcome.parsed).toBeNull()
    expect(outcome.error).toMatch(/30 seconds/)
  })

  it('does not retry an HTTP failure', async () => {
    const complete = vi
      .fn<ContentModel['complete']>()
      .mockRejectedValue(new Error('DeepSeek returned 500: upstream error'))
    const outcome = await runContentCheck({
      model: model(complete),
      request,
      transcript: TRANSCRIPT,
    })
    expect(outcome.calls).toBe(1)
    expect(outcome.error).toMatch(/500/)
  })

  it('degrades to full content points on any failure', async () => {
    const outcome = await runContentCheck({
      model: model(async () => 'garbage'),
      request,
      transcript: TRANSCRIPT,
    })
    expect(scoreContent(outcome.parsed ?? notCheckedContent()).total).toBe(50)
  })

  it('keeps missing or invalid provider configuration inside the user-favoring boundary', async () => {
    const outcome = await runContentCheckSafely({
      createModel() {
        throw new Error('configuration contained a secret value that must not escape')
      },
      request,
      transcript: TRANSCRIPT,
    })
    expect(outcome).toMatchObject({
      model: null,
      parsed: null,
      error: 'The content provider was unavailable.',
      calls: 0,
      tighten: null,
    })
    expect(outcome.error).not.toContain('secret value')
    expect(scoreContent(outcome.parsed ?? notCheckedContent()).total).toBe(50)
  })
})

describe('nothing is counted twice', () => {
  const spoken = 'Uh, I would, um, probably spend a lot of time in Brooklyn. Yeah.'
  const counted = ['Uh,', 'um,', 'Yeah.']

  it('drops a span the mechanical filler detector already charged', () => {
    const parsed = parseContentResponse(
      JSON.stringify({
        checks: {
          answered: { passed: true },
          explained: { passed: true },
          logical_order: { passed: true },
          no_repetition: { passed: true },
          word_choice: { passed: true },
        },
        extra_spans: [
          { text: 'um', category: 'padding' },
          { text: 'Uh', category: 'padding' },
          { text: 'Yeah', category: 'padding' },
          { text: 'a lot of', category: 'qualifier' },
        ],
        tightened: null,
      }),
      spoken,
      counted,
    )

    expect(parsed.extra_spans.map((span) => span.text)).toEqual(['a lot of'])
    expect(parsed.dropped.filter((note) => note.includes('already counted'))).toHaveLength(3)
  })

  it('keeps word choice points intact when every span was already charged', () => {
    const parsed = parseContentResponse(
      JSON.stringify({
        checks: {
          answered: { passed: true },
          explained: { passed: true },
          logical_order: { passed: true },
          no_repetition: { passed: true },
          word_choice: { passed: true },
        },
        extra_spans: [
          { text: 'um', category: 'padding' },
          { text: 'Uh', category: 'padding' },
        ],
        tightened: null,
      }),
      spoken,
      counted,
    )
    expect(scoreContent(parsed).points.word_choice).toBe(12)
  })

  it('drops a word choice finding that quotes an already counted filler', () => {
    const parsed = parseContentResponse(
      JSON.stringify({
        checks: {
          answered: { passed: true },
          explained: { passed: true },
          logical_order: { passed: true },
          no_repetition: { passed: true },
          word_choice: { passed: false, severity: 'clear', quote: 'um', observation: 'x' },
        },
        extra_spans: [],
        tightened: null,
      }),
      spoken,
      counted,
    )
    expect(parsed.checks.word_choice.passed).toBe(true)
    expect(scoreContent(parsed).points.word_choice).toBe(12)
  })

  it('still charges a genuine span that was not counted mechanically', () => {
    const parsed = parseContentResponse(
      JSON.stringify({
        checks: {
          answered: { passed: true },
          explained: { passed: true },
          logical_order: { passed: true },
          no_repetition: { passed: true },
          word_choice: { passed: true },
        },
        extra_spans: [{ text: 'a lot of', category: 'qualifier' }],
        tightened: null,
      }),
      spoken,
      counted,
    )
    expect(scoreContent(parsed).points.word_choice).toBe(9)
  })
})

describe('the tightened length band', () => {
  // 60 words, so the arithmetic below is easy to follow.
  const original = Array.from({ length: 60 }, (_v, i) => `word${i}`).join(' ')

  function check(rewrittenWords: number, spans: string[], countedTokens: number) {
    const body = JSON.stringify({
      checks: {
        answered: { passed: true },
        explained: { passed: true },
        logical_order: { passed: true },
        no_repetition: { passed: true },
        word_choice: { passed: true },
      },
      extra_spans: spans.map((text) => ({ text, category: 'padding' })),
      tightened: Array.from({ length: rewrittenWords }, (_v, i) => `word${i}`).join(' '),
    })
    return parseContentResponse(body, original, [], countedTokens)
  }

  /**
   * Four filler tokens and four two word spans should shorten a 60 word response
   * to about 48. Measured against the original this was discarded, which is
   * exactly backwards: the rewrite matters most on the messiest responses.
   */
  it('accepts a rewrite that removed exactly what was flagged', () => {
    const spans = ['word1 word2', 'word3 word4', 'word5 word6', 'word7 word8']
    const parsed = check(48, spans, 4)
    expect(parsed.tightened).not.toBeNull()
    expect(parsed.dropped).toEqual([])
  })

  it('accepts the same rewrite at either edge of the band', () => {
    const spans = ['word1 word2', 'word3 word4', 'word5 word6', 'word7 word8']
    // expected is 60 - 8 - 4 = 48, so the band runs 41 to 60 words.
    expect(check(41, spans, 4).tightened).not.toBeNull()
    expect(check(59, spans, 4).tightened).not.toBeNull()
  })

  it('rejects a rewrite that summarized away half the content', () => {
    const spans = ['word1 word2', 'word3 word4', 'word5 word6', 'word7 word8']
    const parsed = check(24, spans, 4)
    expect(parsed.tightened).toBeNull()
    expect(parsed.dropped.join(' ')).toMatch(/expected 48/)
    expect(parsed.dropped.join(' ')).toMatch(/60 spoken minus 12 flagged/)
  })

  it('rejects a rewrite that grew instead of tightening', () => {
    // Nothing flagged, so the ceiling is 125 percent of 60 words.
    expect(check(80, [], 0).tightened).toBeNull()
  })

  /** Repairing grammar around each deletion adds words back, so the ceiling has room. */
  it('accepts a rewrite that came back slightly above the naive expectation', () => {
    const spans = ['word1 word2', 'word3 word4']
    // expected is 60 - 4 - 4 = 52, and 65 words is 125 percent of it.
    expect(check(64, spans, 4).tightened).not.toBeNull()
  })

  it('keeps a clean response at roughly its original length', () => {
    // Nothing flagged, so expected is the original and the band is 51 to 75.
    expect(check(59, [], 0).tightened).not.toBeNull()
    expect(check(40, [], 0).tightened).toBeNull()
  })
})

describe('one span, counted once and shown once', () => {
  const spoken = "I'd say it's probably just, fine. I feel like the food there is good."

  const parsed = parseContentResponse(
    JSON.stringify({
      checks: {
        answered: { passed: true },
        explained: { passed: true },
        logical_order: { passed: true },
        no_repetition: { passed: true },
        word_choice: {
          passed: false,
          severity: 'clear',
          quote: 'probably just,',
          observation: 'x',
        },
      },
      extra_spans: [
        { text: 'probably just', category: 'padding' },
        { text: 'I feel like', category: 'padding' },
      ],
      tightened: null,
    }),
    spoken,
  )

  /** The same span arrived twice, punctuated differently. It is still one span. */
  it('charges a span quoted in the finding and listed again as one', () => {
    expect(scoreContent(parsed).points.word_choice).toBe(7)
  })

  it('releases the listed copy when the quoted finding is kept', () => {
    const adjusted = applyDisputes(parsed, [{ note_type: 'word_choice', quote: 'probably just,' }])
    expect(adjusted.extra_spans.map((span) => span.text)).toEqual(['I feel like'])
    expect(scoreContent(adjusted).points.word_choice).toBe(9)
  })
})
