/** Local calendar day as YYYY-MM-DD. Streaks are counted in the viewer's day. */
export function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
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
