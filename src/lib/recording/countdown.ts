export const MIN_COUNTDOWN_SECONDS = 3
export const MAX_COUNTDOWN_SECONDS = 8

const BASE_SECONDS = 2
const SECONDS_PER_WORD = 0.4

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
}

/**
 * Long enough to read the prompt, short enough to leave no room to plan an
 * answer. 2 seconds plus 0.4 per word, clamped to 3 to 8.
 */
export function countdownSecondsFor(promptText: string): number {
  const seconds = BASE_SECONDS + SECONDS_PER_WORD * countWords(promptText)
  const clamped = Math.min(Math.max(seconds, MIN_COUNTDOWN_SECONDS), MAX_COUNTDOWN_SECONDS)
  // Guards against float drift such as 5.999999999999999 for a 10 word prompt.
  return Math.round(clamped * 1000) / 1000
}
