import {
  BANNED_PHRASE_END,
  BANNED_PHRASE_START,
  isContentBearing,
  isFunctionWord,
  looksLikeVerb,
} from '@/lib/scoring/lexicon'
import { standardDeviation } from '@/lib/scoring/scale'
import { sentenceRanges, type Token } from '@/lib/scoring/tokens'

export interface RepeatedPhrase {
  phrase: string
  count: number
}

const MIN_PHRASE_WORDS = 2
const MAX_PHRASE_WORDS = 6
const MAX_REPORTED = 5

const ADVERBIAL = /ly$/

/**
 * A phrase made only of content nouns is naming the subject, not padding. In a
 * recipe explanation "white rice" has to repeat, and charging for it would be
 * charging someone for talking about their topic.
 */
function namesTheSubject(words: readonly string[]): boolean {
  return words.every(
    (word) => !isFunctionWord(word) && !looksLikeVerb(word) && !ADVERBIAL.test(word),
  )
}

/**
 * Feeds the no repetition check, so the model anchors to data rather than taste.
 *
 * A phrase only belongs here if a listener would actually notice it repeating.
 * Without the edge and content rules this produced fragments like "city i",
 * which spans a clause boundary and is not a phrase at all, and empty pairs
 * like "a pretty" and "the different", one of which reached the score.
 */
export function repeatedPhrases(tokens: readonly Token[]): RepeatedPhrase[] {
  const counts = new Map<string, number>()

  // Never cross a sentence boundary: a phrase that does is not a phrase.
  for (const sentence of sentenceRanges(tokens)) {
    const words = tokens.slice(sentence.from, sentence.to + 1).map((token) => token.word)

    for (let size = MIN_PHRASE_WORDS; size <= MAX_PHRASE_WORDS; size += 1) {
      for (let at = 0; at + size <= words.length; at += 1) {
        const slice = words.slice(at, at + size)
        const first = slice[0]!
        const last = slice[slice.length - 1]!

        if (BANNED_PHRASE_START.has(first)) continue
        if (BANNED_PHRASE_END.has(last)) continue
        // At least one noun or verb, so strings of determiners and generic
        // adjectives never qualify.
        if (!slice.some((word) => isContentBearing(word))) continue
        if (slice.every((word) => isFunctionWord(word))) continue
        if (namesTheSubject(slice)) continue

        const phrase = slice.join(' ')
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1)
      }
    }
  }

  const repeated = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([phrase, count]) => ({ phrase, count }))

  // Collapse overlapping n-grams: keep the longest form of an equally frequent phrase.
  const collapsed = repeated.filter(
    (candidate) =>
      !repeated.some(
        (other) =>
          other.phrase !== candidate.phrase &&
          other.count >= candidate.count &&
          other.phrase.includes(candidate.phrase),
      ),
  )

  return collapsed
    .sort((a, b) => b.count - a.count || b.phrase.length - a.phrase.length)
    .slice(0, MAX_REPORTED)
}

/**
 * Spread of speaking rate across the response, in words per minute. A statistic
 * only, never scored.
 */
export function paceVariance(tokens: readonly Token[], bucketSeconds = 10): number {
  if (tokens.length < 2) return 0
  const buckets = new Map<number, number>()
  for (const token of tokens) {
    const bucket = Math.floor(token.start / bucketSeconds)
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
  }
  const rates = [...buckets.values()].map((count) => (count / bucketSeconds) * 60)
  return standardDeviation(rates)
}
