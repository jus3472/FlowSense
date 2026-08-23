/**
 * Playback helpers, kept separate from the player component so the parts worth
 * testing are pure. Everything here exists because of how iOS WebKit behaves.
 */

/** The slice of TimeRanges this code reads, so tests can stand in for it. */
export interface TimeRangesLike {
  readonly length: number
  start(index: number): number
  end(index: number): number
}

export interface Range {
  start: number
  end: number
}

export function rangesToArray(ranges: TimeRangesLike | null | undefined): Range[] {
  if (!ranges) return []
  const out: Range[] = []
  for (let index = 0; index < ranges.length; index += 1) {
    out.push({ start: ranges.start(index), end: ranges.end(index) })
  }
  return out
}

/**
 * Whether a seek to `seconds` will actually land.
 *
 * Assigning currentTime outside the seekable ranges fails silently on iOS: no
 * throw, no seeked event, no sound. The small tolerance covers the rounding
 * between our measured duration and what the container reports.
 */
export function isWithinRanges(
  ranges: TimeRangesLike | null | undefined,
  seconds: number,
  tolerance = 0.25,
): boolean {
  if (!ranges || ranges.length === 0) return false
  for (let index = 0; index < ranges.length; index += 1) {
    if (seconds >= ranges.start(index) - tolerance && seconds <= ranges.end(index) + tolerance) {
      return true
    }
  }
  return false
}

/**
 * play() returns a promise that rejects more often on iOS than anywhere else,
 * and a rejection is the difference between "no sound" and "no sound plus an
 * explanation". Every branch here names something the listener can act on.
 */
export function describePlaybackError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''

  if (name === 'NotAllowedError') {
    return 'Your browser blocked playback. Press play again.'
  }
  if (name === 'AbortError') {
    return 'Playback was interrupted before it started. Press play again.'
  }
  if (name === 'NotSupportedError') {
    return 'This browser cannot play this recording.'
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return 'Playback did not start. Press play again.'
}

/**
 * The measured duration is the source of truth, because MediaRecorder
 * containers routinely report Infinity, NaN, or 0. The element's own duration is
 * only a fallback for rows recorded before the length was captured.
 */
export function resolveDurationMs(measuredMs: number, elementDurationSeconds: number): number {
  if (Number.isFinite(measuredMs) && measuredMs > 0) return measuredMs
  if (Number.isFinite(elementDurationSeconds) && elementDurationSeconds > 0) {
    return Math.round(elementDurationSeconds * 1000)
  }
  return 0
}
