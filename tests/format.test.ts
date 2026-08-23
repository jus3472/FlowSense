import { describe, expect, it } from 'vitest'
import { formatDuration } from '@/lib/recording/format'

describe('formatDuration', () => {
  it('shows 0:00 before anything has played', () => {
    expect(formatDuration(0)).toBe('0:00')
  })

  it('pads seconds to two digits', () => {
    expect(formatDuration(1000)).toBe('0:01')
    expect(formatDuration(9999)).toBe('0:09')
    expect(formatDuration(42_000)).toBe('0:42')
  })

  it('rolls over into minutes', () => {
    expect(formatDuration(60_000)).toBe('1:00')
    expect(formatDuration(61_000)).toBe('1:01')
    expect(formatDuration(125_000)).toBe('2:05')
  })

  it('truncates rather than rounds, so the clock never runs ahead', () => {
    expect(formatDuration(1999)).toBe('0:01')
  })

  /** MediaRecorder blobs report Infinity for duration. That must not leak out. */
  it('falls back to 0:00 for values that are not real durations', () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatDuration(Number.NaN)).toBe('0:00')
    expect(formatDuration(-1)).toBe('0:00')
  })
})
