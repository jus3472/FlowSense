/** Local calendar day as YYYY-MM-DD. Streaks are counted in the viewer's day. */
export function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export interface ActivityStreak {
  current: number
  todayActive: boolean
}

function parseLocalDate(value: string): Date | null {
  const match = LOCAL_DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null
}

function shiftLocalDate(value: string, days: number): string | null {
  const date = parseLocalDate(value)
  if (!date) return null
  date.setUTCDate(date.getUTCDate() + days)
  return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, '0')}-${`${date.getUTCDate()}`.padStart(2, '0')}`
}

/** Derives the current streak from durable local calendar dates. */
export function computeActivityStreak(
  localDates: readonly string[],
  today: string,
): ActivityStreak {
  if (!parseLocalDate(today)) throw new Error('A valid local date is required.')

  const days = new Set(localDates.filter((value) => parseLocalDate(value) !== null))
  const todayActive = days.has(today)
  let cursor = todayActive ? today : shiftLocalDate(today, -1)
  let current = 0

  while (cursor && days.has(cursor)) {
    current += 1
    cursor = shiftLocalDate(cursor, -1)
  }

  return { current, todayActive }
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Consecutive days with at least one attempt, counted back from today. A day
 * with no attempt yet does not break the streak until it is over, so a user who
 * answered yesterday and has not answered today still holds their streak.
 */
export function computeStreak(timestamps: readonly string[], now: Date = new Date()): number {
  if (timestamps.length === 0) return 0

  const days = new Set<string>()
  for (const timestamp of timestamps) {
    const date = new Date(timestamp)
    if (!Number.isNaN(date.getTime())) days.add(dayKey(date))
  }

  let cursor = new Date(now)
  if (!days.has(dayKey(cursor))) {
    cursor = shiftDays(cursor, -1)
    if (!days.has(dayKey(cursor))) return 0
  }

  let streak = 0
  while (days.has(dayKey(cursor))) {
    streak += 1
    cursor = shiftDays(cursor, -1)
  }
  return streak
}
