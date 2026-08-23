import { describe, expect, it } from 'vitest'
import {
  describePlaybackError,
  isWithinRanges,
  rangesToArray,
  resolveDurationMs,
  type TimeRangesLike,
} from '@/lib/recording/playback'

function ranges(...pairs: Array<[number, number]>): TimeRangesLike {
  return {
    length: pairs.length,
    start: (index: number) => pairs[index]?.[0] ?? 0,
    end: (index: number) => pairs[index]?.[1] ?? 0,
  }
}

describe('rangesToArray', () => {
  it('reads every range out of a TimeRanges', () => {
    expect(rangesToArray(ranges([0, 5], [10, 12]))).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 12 },
    ])
  })

  it('is empty for no ranges, null, or undefined', () => {
    expect(rangesToArray(ranges())).toEqual([])
    expect(rangesToArray(null)).toEqual([])
    expect(rangesToArray(undefined)).toEqual([])
  })
})

describe('isWithinRanges', () => {
  /** iOS reports an empty seekable until the first gesture loads the file. */
  it('refuses to seek when nothing is seekable yet', () => {
    expect(isWithinRanges(ranges(), 0)).toBe(false)
    expect(isWithinRanges(null, 0)).toBe(false)
  })

  it('accepts a point inside a range', () => {
    expect(isWithinRanges(ranges([0, 22.44]), 11)).toBe(true)
    expect(isWithinRanges(ranges([0, 22.44]), 0)).toBe(true)
  })

  it('rejects a point past what has loaded', () => {
    expect(isWithinRanges(ranges([0, 5]), 11)).toBe(false)
  })

  it('tolerates the gap between our measured duration and the container', () => {
    // Measured 22.509s, container says 22.44s. Seeking to the end must still work.
    expect(isWithinRanges(ranges([0, 22.44]), 22.509)).toBe(true)
  })

  it('handles a gap between two buffered ranges', () => {
    expect(isWithinRanges(ranges([0, 5], [10, 20]), 7)).toBe(false)
    expect(isWithinRanges(ranges([0, 5], [10, 20]), 15)).toBe(true)
  })
})

describe('describePlaybackError', () => {
  it('names the gesture rejection iOS raises', () => {
    expect(describePlaybackError(new DOMException('x', 'NotAllowedError'))).toMatch(/blocked/i)
  })

  it('names an interrupted start', () => {
    expect(describePlaybackError(new DOMException('x', 'AbortError'))).toMatch(/interrupted/i)
  })

  it('names an unplayable container', () => {
    expect(describePlaybackError(new DOMException('x', 'NotSupportedError'))).toMatch(
      /cannot play/i,
    )
  })

  it('falls back to the message on an ordinary error', () => {
    expect(describePlaybackError(new Error('decoder gave up'))).toBe('decoder gave up')
  })

  it('always returns a sentence, never an empty string', () => {
    for (const value of [null, undefined, '', 0, {}, new Error('')]) {
      expect(describePlaybackError(value).length).toBeGreaterThan(0)
    }
  })
})

describe('resolveDurationMs', () => {
  it('prefers the duration measured during capture', () => {
    expect(resolveDurationMs(22_509, 22.44)).toBe(22_509)
  })

  /** MediaRecorder containers report these routinely, iOS mp4 most of all. */
  it('falls back to the element when the measurement is missing', () => {
    expect(resolveDurationMs(0, 22.44)).toBe(22_440)
  })

  it('returns 0 when neither source knows', () => {
    expect(resolveDurationMs(0, Number.NaN)).toBe(0)
    expect(resolveDurationMs(0, Number.POSITIVE_INFINITY)).toBe(0)
    expect(resolveDurationMs(Number.NaN, 0)).toBe(0)
  })

  it('never trusts an infinite element duration over a real measurement', () => {
    expect(resolveDurationMs(30_000, Number.POSITIVE_INFINITY)).toBe(30_000)
  })
})
