export const UTC_TIMEZONE = 'UTC'

/** Accepts a bounded timezone name that the current JavaScript runtime recognizes. */
export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) return false
  if (!/^[A-Za-z0-9_+\-/]+$/.test(value)) return false

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

export function safeTimezone(value: unknown): string {
  return isValidIanaTimezone(value) ? value : UTC_TIMEZONE
}

/** Returns the calendar date at one instant in a validated IANA timezone. */
export function localDateKey(instant: Date, timezone: string): string {
  if (!Number.isFinite(instant.getTime())) throw new Error('A valid instant is required.')
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}
