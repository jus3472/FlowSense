import { describe, expect, it } from 'vitest'
import { analyseFillers } from '@/lib/scoring/fillers'
import { tokensFrom } from './helpers/transcript'

function analyse(transcript: string) {
  const tokens = tokensFrom(transcript)
  return analyseFillers(tokens, tokens.length)
}

const fillersIn = (transcript: string) => analyse(transcript).filler_tokens
const falseStartsIn = (transcript: string) => analyse(transcript).false_start_tokens

describe('filler tokens: like', () => {
  it('does not count a preference, with or without an adverb', () => {
    expect(fillersIn("I really like how it's close.")).toBe(0)
    expect(fillersIn('I like it.')).toBe(0)
    expect(fillersIn('We definitely like that.')).toBe(0)
  })

  it('counts a comma bounded like before a number', () => {
    expect(fillersIn('and, like, five books')).toBe(1)
  })

  it('does not count like introducing an example', () => {
    expect(fillersIn('AI tools like Lovable')).toBe(0)
    expect(fillersIn('games like chess')).toBe(0)
  })

  it('does not count like after a placeholder noun', () => {
    expect(fillersIn('stuff like that')).toBe(0)
    expect(fillersIn('something like this')).toBe(0)
  })

  it('does not count like after an auxiliary or negation', () => {
    expect(fillersIn('I would like that.')).toBe(0)
    expect(fillersIn("I don't like it.")).toBe(0)
    expect(fillersIn("I didn't like it.")).toBe(0)
  })

  it('counts quotative like after a form of be', () => {
    expect(fillersIn('I was like, no way.')).toBeGreaterThanOrEqual(1)
  })
})

describe('filler tokens: actually and really', () => {
  it('does not count an adverb modifying a verb', () => {
    expect(fillersIn('if you actually like a job')).toBe(0)
    expect(fillersIn('we are actually solving it')).toBe(0)
  })

  it('counts a comma bounded discourse marker', () => {
    expect(fillersIn('It was, actually, fine.')).toBe(1)
  })

  it('counts one opening a sentence', () => {
    expect(fillersIn('Actually, I went home.')).toBe(1)
  })
})

describe('filler tokens: address terms', () => {
  it('does not count man as a subject complement', () => {
    expect(fillersIn("he's a good man")).toBe(0)
  })

  it('counts man as an address term', () => {
    expect(fillersIn('come on, man')).toBe(1)
  })
})

describe('filler tokens: kind of and sort of', () => {
  it('does not count a category', () => {
    expect(fillersIn('a kind of bird')).toBe(0)
    expect(fillersIn('sort of the point')).toBe(0)
  })

  it('counts a hedge as its two tokens', () => {
    expect(fillersIn('it was kind of hard')).toBe(2)
  })
})

describe('false starts', () => {
  it('counts each discarded repeat', () => {
    expect(falseStartsIn('I I I used to')).toBe(2)
  })

  it('counts one repeat across an intervening filler', () => {
    expect(falseStartsIn('I, um, I really liked it')).toBe(1)
  })

  it('does not count a reused adjective', () => {
    expect(falseStartsIn('great example of great character development')).toBe(0)
  })

  it('does not count a coordinated list', () => {
    expect(
      falseStartsIn('the Hispanic community, the Chinese community, the Korean community'),
    ).toBe(0)
  })

  it('does not count repeated connectives', () => {
    expect(
      falseStartsIn('experience as well as design experience as well as coding experience'),
    ).toBe(0)
  })

  it('counts the first attempt of a clause restart as discarded', () => {
    const result = analyse("I'm good at Smash. I'm good at playing Smash.")
    const clause = result.hits.find((hit) => hit.subtype === 'clause_restart')
    expect(clause).toBeDefined()
    expect(clause?.token_indices).toHaveLength(4)
    expect(clause?.text).toContain("I'm good at Smash")
  })
})

describe('backtracks', () => {
  it('never charges a self correction and counts it once', () => {
    const result = analyse('I love pizza, oh wait, I mean I love sushi.')
    expect(result.false_start_tokens).toBe(0)
    expect(result.backtracks).toHaveLength(1)
  })

  it('does not let the correction connector count as a filler', () => {
    const result = analyse('I love pizza, oh wait, I mean I love sushi.')
    const meanHit = result.hits.find((hit) => hit.subtype === 'i mean')
    expect(meanHit).toBeUndefined()
  })
})

describe('throwaway closers', () => {
  it('counts the tokens of a closing hedge', () => {
    const result = analyse('I went to the park but yeah')
    expect(result.closer_tokens).toBe(2)
  })

  it('counts a closer once rather than also as a filler', () => {
    const result = analyse('It was fine, you know')
    expect(result.closer_tokens).toBe(2)
    expect(result.filler_tokens).toBe(0)
  })
})

describe('the ledger', () => {
  it('never counts one token under two categories', () => {
    const transcript =
      'So, um, I I really like it, you know, but actually, I mean, it was kind of hard, but yeah'
    const result = analyse(transcript)
    const seen = new Set<number>()
    for (const hit of result.hits) {
      for (const index of hit.token_indices) {
        expect(seen.has(index), `token ${index} counted twice`).toBe(false)
        seen.add(index)
      }
    }
    expect(result.counted_tokens).toBe(seen.size)
  })
})

describe('adjacent repeated tokens', () => {
  /**
   * A doubled word with nothing between it is the simplest possible restart.
   * The connective rule, which exists for parallel lists, was skipping these
   * before the comparison ever ran.
   */
  it('counts a doubled connective', () => {
    expect(
      falseStartsIn("I think the competition is just worthless, and and it's not even that fun"),
    ).toBe(1)
  })

  it.each(['and and', 'so so', 'but but', 'or or', 'the the', 'to to'])(
    'counts "%s" as one false start',
    (pair) => {
      expect(falseStartsIn(`I went ${pair} home yesterday`)).toBe(1)
    },
  )

  it('still counts a triple as two', () => {
    expect(falseStartsIn('I I I used to')).toBe(2)
  })

  /** Repeated at a distance across a list is parallel structure, not a fumble. */
  it('still ignores connectives repeated at a distance', () => {
    expect(
      falseStartsIn('experience as well as design experience as well as coding experience'),
    ).toBe(0)
    expect(
      falseStartsIn('the Hispanic community, the Chinese community, the Korean community'),
    ).toBe(0)
  })
})
