import { describe, expect, it } from 'vitest'
import { browserTimezone, isValidIanaTimezone, localDateKey, safeTimezone } from '@/lib/timezone'

describe('profile timezone', () => {
  it.each(['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London'])(
    'accepts %s',
    (timezone) => expect(isValidIanaTimezone(timezone)).toBe(true),
  )

  it.each(['', 'Mars/Olympus', '../America/New_York', 'America/New York', 'x\nUTC'])(
    'rejects %j',
    (timezone) => expect(isValidIanaTimezone(timezone)).toBe(false),
  )

  it('uses UTC when a stored timezone is absent or invalid', () => {
    expect(safeTimezone(null)).toBe('UTC')
    expect(safeTimezone('Mars/Olympus')).toBe('UTC')
  })

  it('captures a browser timezone and falls back without blocking', () => {
    expect(browserTimezone(() => 'America/New_York')).toBe('America/New_York')
    expect(browserTimezone(() => 'Mars/Olympus')).toBe('UTC')
    expect(
      browserTimezone(() => {
        throw new Error('unavailable')
      }),
    ).toBe('UTC')
  })

  it('uses the local date on opposite sides of midnight', () => {
    const instant = new Date('2026-08-28T03:30:00.000Z')
    expect(localDateKey(instant, 'America/New_York')).toBe('2026-08-27')
    expect(localDateKey(instant, 'Europe/London')).toBe('2026-08-28')
  })

  it('falls back to the UTC date for an unavailable timezone', () => {
    expect(localDateKey(new Date('2026-08-28T23:30:00.000Z'), 'invalid')).toBe('2026-08-28')
  })
})
