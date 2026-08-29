import { describe, expect, it } from 'vitest'
import { computeActivityStreak, computeStreak, dayKey } from '@/lib/streak'

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

describe('computeActivityStreak', () => {
  it('reports today active and counts backward from today', () => {
    expect(computeActivityStreak(['2026-08-23', '2026-08-22', '2026-08-21'], '2026-08-23')).toEqual(
      { current: 3, todayActive: true },
    )
  })

  it('lets yesterday anchor a streak before today is complete', () => {
    expect(computeActivityStreak(['2026-08-22', '2026-08-21'], '2026-08-23')).toEqual({
      current: 2,
      todayActive: false,
    })
  })

  it('breaks after a missed local day', () => {
    expect(computeActivityStreak(['2026-08-21', '2026-08-20'], '2026-08-23')).toEqual({
      current: 0,
      todayActive: false,
    })
  })

  it('deduplicates dates and ignores malformed calendar values', () => {
    expect(
      computeActivityStreak(['2026-08-23', '2026-08-23', '2026-02-30', 'not-a-date'], '2026-08-23'),
    ).toEqual({ current: 1, todayActive: true })
  })

  it('handles year boundaries without the server timezone', () => {
    expect(computeActivityStreak(['2027-01-01', '2026-12-31'], '2027-01-02')).toEqual({
      current: 2,
      todayActive: false,
    })
  })
})
