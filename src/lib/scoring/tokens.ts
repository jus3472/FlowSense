import type { TranscriptWord } from '@/lib/deepgram/parse'

/**
 * A transcript word paired with the punctuation around it.
 *
 * Deepgram's `words` array is lowercase and stripped of punctuation, while the
 * `transcript` string carries it. Almost every filler rule below depends on
 * punctuation ("bounded by commas", "opening a sentence"), so the two are
 * zipped back together here rather than storing a second copy per word.
 */
export interface Token {
  index: number
  /** Lowercased, punctuation stripped. Apostrophes and hyphens survive. */
  word: string
  /** Exactly as written in the transcript, e.g. "So," */
  raw: string
  start: number
  end: number
  /** Punctuation attached to the end of this token, e.g. "," or "." */
  trailing: string
  startsSentence: boolean
  endsSentence: boolean
  /** True when a comma immediately precedes this token. */
  afterComma: boolean
  capitalized: boolean
  /** Offsets into the transcript, so the results view can slice it exactly. */
  charStart: number
  charEnd: number
}

const SENTENCE_END = /[.!?]/

export function normalizeWord(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'-]/g, '')
}

/**
 * Walks the punctuated transcript and the word array together. They come from
 * the same Deepgram alternative so they run in lockstep; when a word cannot be
 * matched the transcript pointer holds still rather than drifting, which keeps
 * one bad token from corrupting every token after it.
 */
export function buildTokens(words: readonly TranscriptWord[], transcript: string): Token[] {
  const pieces = [...transcript.matchAll(/\S+/g)].map((match) => ({
    raw: match[0],
    at: match.index,
  }))

  const tokens: Token[] = []
  let cursor = 0
  let sentenceOpen = true

  for (const [index, entry] of words.entries()) {
    const target = normalizeWord(entry.word)

    let matchedAt = -1
    for (let look = cursor; look < Math.min(pieces.length, cursor + 4); look += 1) {
      if (normalizeWord(pieces[look]?.raw ?? '') === target) {
        matchedAt = look
        break
      }
    }

    const piece = matchedAt >= 0 ? pieces[matchedAt] : undefined
    const raw = piece?.raw ?? entry.word
    const trailing = raw.replace(/^[^\p{L}\p{N}]*/u, '').replace(/^.*?([^\p{L}\p{N}']*)$/u, '$1')
    const previousRaw = matchedAt > 0 ? (pieces[matchedAt - 1]?.raw ?? '') : ''

    tokens.push({
      index,
      word: target,
      raw,
      charStart: piece?.at ?? 0,
      charEnd: (piece?.at ?? 0) + raw.length,
      start: entry.start,
      end: entry.end,
      trailing,
      startsSentence: sentenceOpen,
      endsSentence: SENTENCE_END.test(trailing),
      afterComma: previousRaw.endsWith(','),
      capitalized: /^[A-Z]/.test(raw),
    })

    sentenceOpen = SENTENCE_END.test(trailing)
    if (matchedAt >= 0) cursor = matchedAt + 1
  }

  return tokens
}

/**
 * Tokens for text that carries no timings of its own, such as a rewrite. The
 * filler rules read punctuation and position rather than the clock, so the same
 * detector that counted the original can be run over the rewritten version.
 */
export function tokensFromText(text: string): Token[] {
  const raws = text.match(/\S+/g) ?? []
  return buildTokens(
    raws.map((raw, index) => ({ word: normalizeWord(raw), start: index, end: index })),
    text,
  )
}

/** Sentence boundaries as index ranges, for the clause restart rule. */
export function sentenceRanges(tokens: readonly Token[]): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  let from = 0
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.endsSentence || i === tokens.length - 1) {
      ranges.push({ from, to: i })
      from = i + 1
    }
  }
  return ranges.filter((range) => range.to >= range.from)
}

export function joinWords(tokens: readonly Token[], from: number, to: number): string {
  return tokens
    .slice(from, to + 1)
    .map((token) => token.word)
    .join(' ')
}
