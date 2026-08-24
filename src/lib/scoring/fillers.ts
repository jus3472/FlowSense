import {
  AUXILIARIES,
  BE_FORMS,
  CONNECTIVES,
  DETERMINERS,
  LIKE_BLOCKERS,
  PERSONAL_PRONOUNS,
  QUANTIFIERS,
  RESTART_CONNECTORS,
  isFunctionWord,
  looksLikeVerb,
} from '@/lib/scoring/lexicon'
import { sentenceRanges, type Token } from '@/lib/scoring/tokens'

export type FillerCategory = 'filler' | 'false_start' | 'closer'

export interface FillerHit {
  category: FillerCategory
  /** Which rule fired, so a wrong count can be traced to one place. */
  subtype: string
  text: string
  token_indices: number[]
  start: number
  end: number
}

export interface Backtrack {
  text: string
  token_indices: number[]
  start: number
}

export interface FillerAnalysis {
  hits: FillerHit[]
  /** Never scored. Self correction is what a competent speaker does. */
  backtracks: Backtrack[]
  filler_tokens: number
  false_start_tokens: number
  closer_tokens: number
  counted_tokens: number
  rate_per_100_words: number
}

const ADVERBS = new Set([
  'really',
  'definitely',
  'actually',
  'genuinely',
  'truly',
  'honestly',
  'just',
  'also',
  'still',
  'always',
  'never',
  'often',
  'sometimes',
  'probably',
  'certainly',
])

const isAdverb = (word: string) => ADVERBS.has(word) || /ly$/.test(word)

const isNounish = (token: Token | undefined) =>
  Boolean(token) &&
  !isFunctionWord(token!.word) &&
  !looksLikeVerb(token!.word) &&
  !isAdverb(token!.word)

const isNumeric = (word: string) => /^\d/.test(word)

/** Strong enough on their own to mark a self correction. */
const STRONG_BACKTRACKS: readonly string[][] = [
  ['oh', 'wait'],
  ['wait'],
  ['what', 'i', 'meant', 'was'],
  ['what', 'i', 'meant'],
  ['let', 'me', 'back', 'up'],
  ['or', 'rather'],
  ['sorry'],
]

/** Only join a backtrack when they sit next to a strong one. Alone they are fillers. */
const WEAK_BACKTRACKS: readonly string[][] = [['i', 'mean'], ['actually'], ['no']]

const CLOSERS: readonly string[][] = [
  ['but', 'yeah'],
  ["that's", 'about', 'it'],
  ['or', 'whatever'],
  ['something', 'like', 'that'],
  ['i', "don't", 'know'],
  ['so', 'yeah'],
  ['to', 'be', 'honest'],
  ['you', 'know'],
]

const PHRASE_FILLERS: readonly string[][] = [
  ['at', 'the', 'end', 'of', 'the', 'day'],
  ['to', 'be', 'honest'],
  ['you', 'know'],
  ['i', 'mean'],
  ['i', 'guess'],
  ['sort', 'of'],
  ['kind', 'of'],
]

const ALWAYS_FILLERS = new Set([
  'um',
  'uh',
  'er',
  'basically',
  'literally',
  'honestly',
  'yo',
  'duh',
])

function matchesAt(tokens: readonly Token[], at: number, phrase: readonly string[]): boolean {
  return phrase.every((word, offset) => tokens[at + offset]?.word === word)
}

function span(tokens: readonly Token[], from: number, length: number) {
  const slice = tokens.slice(from, from + length)
  return {
    text: slice.map((token) => token.raw).join(' '),
    token_indices: slice.map((token) => token.index),
    start: slice[0]?.start ?? 0,
    end: slice[slice.length - 1]?.end ?? 0,
  }
}

/**
 * `like` is only a filler in the three positions listed. Everything else is a
 * real use: a preference, a comparison, or an example. Each exclusion below
 * came from a real false positive.
 */
function likeIsFiller(tokens: readonly Token[], at: number): boolean {
  const token = tokens[at]
  if (!token) return false
  const prev = tokens[at - 1]
  const prev2 = tokens[at - 2]
  const next = tokens[at + 1]

  if (prev) {
    if (PERSONAL_PRONOUNS.has(prev.word)) return false
    if (isAdverb(prev.word) && prev2 && PERSONAL_PRONOUNS.has(prev2.word)) return false
    if (AUXILIARIES.has(prev.word)) return false
    if (LIKE_BLOCKERS.has(prev.word)) return false
    // "tools like Lovable", "games like chess": a noun introducing an example.
    if (isNounish(prev) && next && (next.capitalized || isNounish(next))) return false
  }

  if (token.afterComma && token.trailing.includes(',')) return true
  if (prev && BE_FORMS.has(prev.word)) return true
  if (next && (isNumeric(next.word) || QUANTIFIERS.has(next.word))) return true
  return false
}

/** `actually` and `really` modify verbs far more often than they pad. */
function discourseAdverbIsFiller(tokens: readonly Token[], at: number): boolean {
  const token = tokens[at]
  if (!token) return false
  const prev = tokens[at - 1]
  const next = tokens[at + 1]

  const subjectBefore =
    prev &&
    (PERSONAL_PRONOUNS.has(prev.word) ||
      BE_FORMS.has(prev.word) ||
      AUXILIARIES.has(prev.word) ||
      isNounish(prev))
  if (subjectBefore && next && looksLikeVerb(next.word)) return false

  if (token.afterComma && token.trailing.includes(',')) return true
  return token.startsSentence
}

/**
 * Address terms only. "he's a good man" is a subject complement, and the comma
 * is what separates the vocative from it.
 */
function addressTermIsFiller(tokens: readonly Token[], at: number): boolean {
  const token = tokens[at]
  if (!token) return false
  return token.afterComma || token.startsSentence
}

/** "a kind of bird" and "sort of the point" name categories rather than hedge. */
function kindOfIsFiller(tokens: readonly Token[], at: number): boolean {
  const prev = tokens[at - 1]
  const after = tokens[at + 2]
  if (prev && DETERMINERS.has(prev.word)) return false
  if (after && DETERMINERS.has(after.word)) return false
  return true
}

function findBacktracks(tokens: readonly Token[], claim: (indices: number[]) => void): Backtrack[] {
  const found: Backtrack[] = []
  let at = 0

  while (at < tokens.length) {
    const strong = STRONG_BACKTRACKS.find((phrase) => matchesAt(tokens, at, phrase))
    if (!strong) {
      at += 1
      continue
    }

    const indices: number[] = []
    let cursor = at
    for (let k = 0; k < strong.length; k += 1) indices.push(tokens[cursor + k]!.index)
    cursor += strong.length

    // Adjacent weak connectors belong to the same correction, not a second one.
    let extended = true
    while (extended) {
      extended = false
      for (const phrase of WEAK_BACKTRACKS) {
        if (matchesAt(tokens, cursor, phrase)) {
          for (let k = 0; k < phrase.length; k += 1) indices.push(tokens[cursor + k]!.index)
          cursor += phrase.length
          extended = true
          break
        }
      }
    }

    // "followed by a new formulation": something has to come after it.
    if (cursor < tokens.length) {
      claim(indices)
      found.push({
        text: indices.map((index) => tokens[index]?.raw ?? '').join(' '),
        token_indices: indices,
        start: tokens[at]?.start ?? 0,
      })
    }
    at = cursor
  }

  return found
}

export function analyseFillers(tokens: readonly Token[], wordCount: number): FillerAnalysis {
  const claimed = new Set<number>()
  const claim = (indices: number[]) => indices.forEach((index) => claimed.add(index))
  const free = (at: number, length: number) =>
    Array.from({ length }, (_value, k) => at + k).every((i) => !claimed.has(tokens[i]?.index ?? -1))

  const hits: FillerHit[] = []

  // 1. Corrections first. They are never charged, and claiming them here stops
  //    their connectors being counted again as fillers.
  const backtracks = findBacktracks(tokens, claim)

  // 2. A closing hedge is counted once, as a closer rather than as a filler.
  for (const phrase of CLOSERS) {
    const at = tokens.length - phrase.length
    if (at < 0 || !matchesAt(tokens, at, phrase) || !free(at, phrase.length)) continue
    const located = span(tokens, at, phrase.length)
    claim(located.token_indices)
    hits.push({ category: 'closer', subtype: phrase.join(' '), ...located })
    break
  }

  // 3. Fillers, longest phrase first so "kind of" never counts as two.
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at]
    if (!token || claimed.has(token.index)) continue

    const phrase = PHRASE_FILLERS.find(
      (candidate) => matchesAt(tokens, at, candidate) && free(at, candidate.length),
    )
    if (phrase) {
      const key = phrase.join(' ')
      if ((key === 'kind of' || key === 'sort of') && !kindOfIsFiller(tokens, at)) continue
      const located = span(tokens, at, phrase.length)
      claim(located.token_indices)
      hits.push({ category: 'filler', subtype: key, ...located })
      at += phrase.length - 1
      continue
    }

    const word = token.word
    let isFiller = false
    if (ALWAYS_FILLERS.has(word)) isFiller = true
    else if (word === 'like') isFiller = likeIsFiller(tokens, at)
    else if (word === 'actually' || word === 'really')
      isFiller = discourseAdverbIsFiller(tokens, at)
    else if (word === 'man' || word === 'bro' || word === 'dude')
      isFiller = addressTermIsFiller(tokens, at)

    if (isFiller) {
      const located = span(tokens, at, 1)
      claim(located.token_indices)
      hits.push({ category: 'filler', subtype: word, ...located })
    }
  }

  const isFillerIndex = new Set(
    hits.filter((hit) => hit.category === 'filler').flatMap((hit) => hit.token_indices),
  )

  /** Only a filler, a correction connector, or nothing may sit inside a repair. */
  const bridgeable = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) {
      const token = tokens[i]
      if (!token) continue
      if (isFillerIndex.has(token.index)) continue
      if (claimed.has(token.index)) continue
      if (RESTART_CONNECTORS.has(token.word)) continue
      return false
    }
    return true
  }

  // 4a. Word level restarts.
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at]
    if (!token || claimed.has(token.index)) continue

    let anchor = at
    for (let look = at + 1; look < tokens.length; look += 1) {
      const candidate = tokens[look]
      if (!candidate) continue
      if (candidate.word !== token.word) continue
      if (!bridgeable(anchor + 1, look)) break

      // "experience as well as design experience as well as" is parallel
      // structure, so a connective repeated at a distance is not a fumble. A
      // doubled word with nothing at all between it is the simplest stumble
      // there is, connective or not, and must count.
      const adjacent = look === anchor + 1
      if (!adjacent && CONNECTIVES.has(token.word)) break

      const located = span(tokens, anchor, 1)
      claim(located.token_indices)
      hits.push({ category: 'false_start', subtype: 'word_restart', ...located })
      anchor = look
    }
  }

  // 4b. Clause restarts: the same opening said again, fuller.
  const sentences = sentenceRanges(tokens)
  for (let s = 0; s + 1 < sentences.length; s += 1) {
    const first = sentences[s]!
    const second = sentences[s + 1]!
    const firstWords = tokens.slice(first.from, first.to + 1)
    const secondWords = tokens.slice(second.from, second.to + 1)

    let shared = 0
    while (
      shared < firstWords.length &&
      shared < secondWords.length &&
      firstWords[shared]!.word === secondWords[shared]!.word
    ) {
      shared += 1
    }

    if (shared >= 3 && secondWords.length > firstWords.length) {
      const indices = firstWords.map((token) => token.index).filter((index) => !claimed.has(index))
      if (indices.length === 0) continue
      claim(indices)
      hits.push({
        category: 'false_start',
        subtype: 'clause_restart',
        text: firstWords.map((token) => token.raw).join(' '),
        token_indices: indices,
        start: firstWords[0]!.start,
        end: firstWords[firstWords.length - 1]!.end,
      })
    }
  }

  const countFor = (category: FillerCategory) =>
    hits
      .filter((hit) => hit.category === category)
      .reduce((sum, hit) => sum + hit.token_indices.length, 0)

  const fillerTokens = countFor('filler')
  const falseStartTokens = countFor('false_start')
  const closerTokens = countFor('closer')
  const counted = fillerTokens + falseStartTokens + closerTokens

  return {
    hits,
    backtracks,
    filler_tokens: fillerTokens,
    false_start_tokens: falseStartTokens,
    closer_tokens: closerTokens,
    counted_tokens: counted,
    rate_per_100_words: wordCount > 0 ? (counted / wordCount) * 100 : 0,
  }
}
