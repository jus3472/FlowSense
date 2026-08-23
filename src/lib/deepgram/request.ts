export const DEEPGRAM_LISTEN_URL = 'https://api.deepgram.com/v1/listen'

/**
 * Nova-2, deliberately, not Nova-3.
 *
 * Nova-3 accepts `filler_words=true` and then ignores it on natural speech. It
 * is not an error, the request succeeds and the transcript comes back clean,
 * which is what makes it dangerous: every filler measurement silently reads
 * zero. Measured on two real 30 and 60 second recordings, nova-3 returned byte
 * identical output whether `filler_words` was set or omitted (52 and 58 words
 * either way, 0 fillers), while nova-2 on the same audio and the same request
 * returned 5 and 1 filler tokens, and dropped back to 52 and 58 words with
 * `filler_words=false`.
 *
 * Deepgram acknowledge this and recommend Nova-2 where filler words matter:
 * https://github.com/orgs/deepgram/discussions/1224
 *
 * Do not "upgrade" this to nova-3 without re-checking filler counts against a
 * real recording. Transcript quality is otherwise the same on this material.
 */
export const DEEPGRAM_MODEL = 'nova-2'

/**
 * Verified against Deepgram's docs and against live requests.
 *
 * `filler_words=true` is the reason FlowSense uses Deepgram at all: it keeps
 * "um" and "uh" as real tokens instead of tidying them away, and every later
 * filler measurement reads them.
 *
 * `smart_format` is deliberately absent. It normalizes and tidies the
 * transcript, which erases the disfluencies being measured, and it overrides
 * `punctuate`. Do not add it.
 */
export function buildDeepgramUrl(): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    filler_words: 'true',
    punctuate: 'true',
  })
  return `${DEEPGRAM_LISTEN_URL}?${params.toString()}`
}

/** Deepgram authenticates with a `Token` prefix, not `Bearer`. */
export function deepgramAuthHeader(apiKey: string): string {
  return `Token ${apiKey}`
}

/** Tokens Deepgram emits as fillers when `filler_words` is honoured. */
const FILLER_TOKENS = new Set(['um', 'uh', 'mhmm', 'mm-mm', 'uh-uh', 'uh-huh', 'nuh-uh'])

export function isFillerToken(word: string): boolean {
  return FILLER_TOKENS.has(word.trim().toLowerCase())
}
