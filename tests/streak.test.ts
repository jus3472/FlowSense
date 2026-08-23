import { describe, expect, it } from 'vitest'
import { computeStreak, dayKey } from '@/lib/streak'

const at = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).toISOString()

describe('computeStreak', () => {
  const now = new Date(2026, 7, 23, 9)

  it('is 0 with no attempts', () => {
    expect(computeStreak([], now)).toBe(0)
  })

  it('counts a single attempt today', () => {
    expect(computeStreak([at(2026, 8, 23)], now)).toBe(1)
  })

  it('counts consecutive days back from today', () => {
    const attempts = [at(2026, 8, 23), at(2026, 8, 22), at(2026, 8, 21)]
    expect(computeStreak(attempts, now)).toBe(3)
  })

  it('counts several attempts on one day once', () => {
    const attempts = [at(2026, 8, 23, 9), at(2026, 8, 23, 20), at(2026, 8, 22)]
    expect(computeStreak(attempts, now)).toBe(2)
  })

  it('holds the streak when today has no attempt yet', () => {
    expect(computeStreak([at(2026, 8, 22), at(2026, 8, 21)], now)).toBe(2)
  })

  it('breaks once a full day is skipped', () => {
    expect(computeStreak([at(2026, 8, 21), at(2026, 8, 20)], now)).toBe(0)
  })

  it('stops at the first gap', () => {
    const attempts = [at(2026, 8, 23), at(2026, 8, 22), at(2026, 8, 20)]
    expect(computeStreak(attempts, now)).toBe(2)
  })

  it('ignores unparseable timestamps', () => {
    expect(computeStreak(['not a date', at(2026, 8, 23)], now)).toBe(1)
  })
})

describe('dayKey', () => {
  it('pads month and day', () => {
    expect(dayKey(new Date(2026, 0, 5, 12))).toBe('2026-01-05')
  })
})
