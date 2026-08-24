import { describe, expect, it, vi } from 'vitest'
import type { ContentModel } from '@/lib/deepseek/provider'
import { runContentCheck } from '@/lib/scoring/run-content'
import {
  findTightenViolations,
  repairAfterRemoval,
  stripViolations,
  surfacesToDelete,
} from '@/lib/scoring/tighten'
import type { FillerHit } from '@/lib/scoring/fillers'

const hit = (over: Partial<FillerHit> = {}): FillerHit => ({
  category: 'filler',
  subtype: 'um',
  text: 'Um,',
  token_indices: [0],
  start: 0,
  end: 0.3,
  ...over,
})

describe('finding what a rewrite kept', () => {
  it('finds the counted fillers a rewrite left in', () => {
    const found = findTightenViolations('Um, I went, uh, to the park, you know.')
    expect(found.map((violation) => violation.text)).toEqual(['Um,', 'uh,', 'you know.'])
    expect(found.every((violation) => violation.source === 'filler')).toBe(true)
  })

  it('says nothing about a rewrite that is already clean', () => {
    expect(findTightenViolations('I went to the park and it was quiet.')).toEqual([])
  })

  /**
   * The detector decides, not a surface match. "like" introducing an example is
   * a real word, and stripping every one of them would rewrite the meaning.
   */
  it('leaves a word alone in the positions where it is not a filler', () => {
    expect(findTightenViolations('I want a city like Tokyo, walkable and quiet.')).toEqual([])
    expect(findTightenViolations('It was, like, twenty people.')).toHaveLength(1)
  })

  /** The stumble is the repetition. The word itself has to survive once. */
  it('flags a doubled word and leaves a word repeated at a distance', () => {
    expect(findTightenViolations('I I went to the park.').map((v) => v.text)).toEqual(['I'])
    expect(findTightenViolations('I went to the park and I went home.')).toEqual([])
  })

  it('finds a flagged word choice span the rewrite promised to cut', () => {
    const found = findTightenViolations('I feel like the food there is good.', ['I feel like'])
    expect(found).toHaveLength(1)
    expect(found[0]?.source).toBe('word_choice')
  })

  it('does not find a span inside a longer word', () => {
    expect(findTightenViolations('I had to adjust the plan.', ['just'])).toEqual([])
  })
})

describe('cutting what the model would not', () => {
  it('removes the fillers and the comma that was holding them apart', () => {
    const stripped = stripViolations(
      "Um, I'd say I picked up habits, but, uh, you know, the main one is reading.",
    )
    expect(stripped.text).toBe("I'd say I picked up habits, but the main one is reading.")
    expect(stripped.remaining).toEqual([])
  })

  it('keeps the full stop when a closing hedge ends the response', () => {
    const stripped = stripViolations('I went to the park. That’s about it.')
    expect(stripped.text).toBe('I went to the park.')
  })

  it('hands the opening of a sentence to the next word', () => {
    expect(stripViolations('Um, the park was quiet.').text).toBe('The park was quiet.')
  })

  it('cuts a flagged span as well as the fillers', () => {
    const stripped = stripViolations('Um, I feel like the food is good.', ['I feel like'])
    expect(stripped.text).toBe('The food is good.')
  })

  it('leaves nothing behind that the detector still counts', () => {
    const messy = 'Um, so, uh, I I went, like, to the park, you know. But yeah.'
    expect(findTightenViolations(stripViolations(messy).text)).toEqual([])
  })

  it('reports what it had to cut', () => {
    const stripped = stripViolations('Um, the park was quiet.')
    expect(stripped.removed).toEqual(['Um,'])
  })
})

describe('repairing punctuation around a removal', () => {
  it('collapses the gap and the stranded marks', () => {
    expect(repairAfterRemoval('I went  to the park , yesterday.')).toBe(
      'I went to the park, yesterday.',
    )
    expect(repairAfterRemoval('I went to the park , .')).toBe('I went to the park.')
    expect(repairAfterRemoval(', I went to the park')).toBe('I went to the park.')
  })

  it('returns nothing for text that lost every word', () => {
    expect(repairAfterRemoval(' , . ')).toBe('')
  })
})

describe('the deletion list the prompt is given', () => {
  it('lists each counted surface once', () => {
    const surfaces = surfacesToDelete([
      hit(),
      hit({ text: 'um,', subtype: 'um' }),
      hit({ text: 'you know', subtype: 'you know', category: 'closer', token_indices: [4, 5] }),
    ])
    expect(surfaces).toEqual(['Um,', 'you know'])
  })

  /** "delete every I" is not an instruction any rewrite can follow. */
  it('leaves false starts off it', () => {
    const surfaces = surfacesToDelete([
      hit({ category: 'false_start', subtype: 'word_restart', text: 'I' }),
      hit(),
    ])
    expect(surfaces).toEqual(['Um,'])
  })
})

describe('enforcing the rewrite end to end', () => {
  const TRANSCRIPT = 'Um, I went to the park, uh, yesterday and it was quiet, you know.'
  const COUNTED = ['Um,', 'uh,', 'you know.']
  const COUNTED_TOKENS = 4

  const model = (complete: ContentModel['complete']): ContentModel => ({ name: 'fake', complete })

  function response(tightened: string) {
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
      tightened,
    })
  }

  const DIRTY = 'Um, I went to the park, uh, yesterday and it was quiet.'
  const CLEAN = 'I went to the park yesterday and it was quiet.'

  function check(complete: ContentModel['complete'], withRetry = true) {
    return runContentCheck({
      model: model(complete),
      request: { system: 's', user: 'u' },
      transcript: TRANSCRIPT,
      countedText: COUNTED,
      countedTokens: COUNTED_TOKENS,
      rewriteRequest: withRetry
        ? ({ mustNotAppear }) => ({ system: 'r', user: mustNotAppear.join(' ') })
        : undefined,
    })
  }

  it('leaves a clean rewrite alone', async () => {
    const outcome = await check(async () => response(CLEAN))
    expect(outcome.parsed?.tightened).toBe(CLEAN)
    expect(outcome.parsed?.tightened_outcome).toBe('clean')
    expect(outcome.calls).toBe(1)
  })

  it('asks again with the offending strings named, and takes the second answer', async () => {
    const complete = vi
      .fn<ContentModel['complete']>()
      .mockResolvedValueOnce(response(DIRTY))
      .mockResolvedValueOnce(JSON.stringify({ tightened: CLEAN }))

    const outcome = await check(complete)
    expect(outcome.parsed?.tightened).toBe(CLEAN)
    expect(outcome.parsed?.tightened_outcome).toBe('retried')
    expect(outcome.calls).toBe(2)
    expect(outcome.tighten?.violations).toEqual(['Um,', 'uh,'])
    // The retry is told exactly which strings came back, not asked again in general.
    expect(complete.mock.calls[1]?.[0].user).toContain('uh,')
  })

  it('cuts the text by hand when the second answer is no better', async () => {
    const outcome = await check(async () => response(DIRTY))
    expect(outcome.parsed?.tightened_outcome).toBe('stripped')
    expect(outcome.parsed?.tightened).toBe(CLEAN)
    expect(outcome.tighten?.removed).toEqual(['Um,', 'uh,'])
  })

  it('cuts the text by hand when there is no second ask to make', async () => {
    const outcome = await check(async () => response(DIRTY), false)
    expect(outcome.parsed?.tightened_outcome).toBe('stripped')
    expect(outcome.calls).toBe(1)
  })

  it('falls back to the strip when the retry itself fails', async () => {
    const complete = vi
      .fn<ContentModel['complete']>()
      .mockResolvedValueOnce(response(DIRTY))
      .mockRejectedValueOnce(new Error('DeepSeek returned 500: upstream error'))

    const outcome = await check(complete)
    expect(outcome.parsed?.tightened_outcome).toBe('stripped')
    expect(outcome.error).toBeNull()
  })

  /** The whole point: nothing counted under Filler words reaches the screen. */
  it('never returns a rewrite that still contains a counted token', async () => {
    for (const complete of [
      async () => response(CLEAN),
      async () => response(DIRTY),
      async () => response('Um, uh, I went to the park, you know, yesterday and it was quiet.'),
    ]) {
      const outcome = await check(complete)
      expect(findTightenViolations(outcome.parsed?.tightened ?? '')).toEqual([])
    }
  })

  it('records no outcome when there was no rewrite to enforce', async () => {
    const outcome = await check(async () =>
      JSON.stringify({
        checks: {
          answered: { passed: true },
          explained: { passed: true },
          logical_order: { passed: true },
          no_repetition: { passed: true },
          word_choice: { passed: true },
        },
        extra_spans: [],
        tightened: null,
      }),
    )
    expect(outcome.parsed?.tightened).toBeNull()
    expect(outcome.parsed?.tightened_outcome).toBe('none')
  })
})
