/** Clock style duration, always at least m:ss. Used for the player and totals. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0:00'

  const totalSeconds = Math.floor(milliseconds / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`
}
