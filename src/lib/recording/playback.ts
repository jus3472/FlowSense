/**
 * Playback helpers, kept separate from the player component so the parts worth
 * testing are pure. Everything here exists because of how browsers disagree
 * about media metadata.
 */

/** HTMLMediaElement.HAVE_METADATA. Enough for the element to accept a seek. */
export const HAVE_METADATA = 1

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
 * Whether the scrubber should be live.
 *
 * Deliberately consults neither `seekable` nor `readyState`. Measured on the
 * same recording: iOS reports `seekable = [0, NaN]` and Chrome reports
 * `seekable = [0, Infinity]`, neither of which describes the file, and every
 * comparison against NaN is false. Readiness is no better, because on a
 * WebKit recorded WebM the duration stays NaN through loadedmetadata and
 * through canplay, resolving only after the whole file downloads.
 *
 * The duration measured during capture is the one trustworthy number, so it is
 * the only gate. A seek that the element is not ready for is caught by the
 * reconciliation in the player rather than pre-emptively refused here.
 */
export function canScrub(state: { totalMs: number; failed: boolean }): boolean {
  return state.totalMs > 0 && !state.failed
}

/** Keeps a seek inside the duration we measured, whatever the container claims. */
export function clampSeekMs(valueMs: number, totalMs: number): number {
  if (!Number.isFinite(valueMs) || valueMs < 0) return 0
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0
  return Math.min(valueMs, totalMs)
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
 * only a fallback for rows recorded before the length was captured, and it is
 * accepted only when finite, so the scrubber math can never see NaN.
 */
export function resolveDurationMs(measuredMs: number, elementDurationSeconds: number): number {
  if (Number.isFinite(measuredMs) && measuredMs > 0) return measuredMs
  if (Number.isFinite(elementDurationSeconds) && elementDurationSeconds > 0) {
    return Math.round(elementDurationSeconds * 1000)
  }
  return 0
}
