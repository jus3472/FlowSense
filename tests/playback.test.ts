import { describe, expect, it } from 'vitest'
import {
  canScrub,
  clampSeekMs,
  describePlaybackError,
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

  /** What iOS 18 and Chrome each report for the very same recording. */
  it('surfaces the useless ends both engines report, without crashing', () => {
    expect(rangesToArray(ranges([0, Number.NaN]))[0]?.end).toBeNaN()
    expect(rangesToArray(ranges([0, Number.POSITIVE_INFINITY]))[0]?.end).toBe(Infinity)
  })
})

describe('canScrub', () => {
  it('is live as soon as a real duration exists', () => {
    expect(canScrub({ totalMs: 24_877, failed: false })).toBe(true)
  })

  it('stays off without a usable duration', () => {
    expect(canScrub({ totalMs: 0, failed: false })).toBe(false)
  })

  it('stays off after a load error', () => {
    expect(canScrub({ totalMs: 24_877, failed: true })).toBe(false)
  })

  /**
   * Two gates that had to go. seekable.end is NaN on iOS, so NaN > 0 kept the
   * scrubber disabled forever. readyState was no better: on a WebKit recorded
   * WebM the duration stays NaN through loadedmetadata and through canplay, and
   * resolves only once the whole file has downloaded, which on a slow
   * connection is never within the listener's patience.
   */
  it('does not depend on seekable or on element readiness', () => {
    expect(canScrub({ totalMs: 24_877, failed: false })).toBe(true)
  })
})

describe('clampSeekMs', () => {
  it('passes a position inside the recording straight through', () => {
    expect(clampSeekMs(10_000, 21_951)).toBe(10_000)
  })

  it('clamps past the end back to the measured duration', () => {
    expect(clampSeekMs(30_000, 21_951)).toBe(21_951)
  })

  it('clamps negatives and rubbish to the start', () => {
    expect(clampSeekMs(-5, 21_951)).toBe(0)
    expect(clampSeekMs(Number.NaN, 21_951)).toBe(0)
    expect(clampSeekMs(Number.POSITIVE_INFINITY, 21_951)).toBe(0)
  })

  it('refuses to seek at all without a usable duration', () => {
    expect(clampSeekMs(10_000, 0)).toBe(0)
    expect(clampSeekMs(10_000, Number.NaN)).toBe(0)
    expect(clampSeekMs(10_000, Number.POSITIVE_INFINITY)).toBe(0)
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
    expect(resolveDurationMs(21_951, 21.953)).toBe(21_951)
  })

  it('falls back to the element when the measurement is missing', () => {
    expect(resolveDurationMs(0, 21.953)).toBe(21_953)
  })

  /**
   * Chrome reports Infinity for our WebM even at readyState 4, and iOS reports
   * NaN before metadata arrives. Neither may ever reach the scrubber math.
   */
  it('never lets a non finite element duration through', () => {
    expect(resolveDurationMs(0, Number.POSITIVE_INFINITY)).toBe(0)
    expect(resolveDurationMs(0, Number.NaN)).toBe(0)
    expect(resolveDurationMs(0, Number.NEGATIVE_INFINITY)).toBe(0)
    expect(resolveDurationMs(Number.NaN, Number.NaN)).toBe(0)
  })

  it('always returns a finite, non negative number', () => {
    const inputs = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 21_951]
    for (const measured of inputs) {
      for (const element of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 21.953]) {
        const result = resolveDurationMs(measured, element)
        expect(Number.isFinite(result)).toBe(true)
        expect(result).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('keeps the measurement even when the element claims Infinity', () => {
    expect(resolveDurationMs(30_000, Number.POSITIVE_INFINITY)).toBe(30_000)
  })
})
