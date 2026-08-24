export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Linear ramp between the value that earns everything and the value that earns
 * nothing. Works in either direction, so "lower is better" and "higher is
 * better" metrics share one function.
 */
export function ramp(value: number, atFull: number, atZero: number): number {
  if (!Number.isFinite(value)) return 0
  if (atFull === atZero) return value === atFull ? 1 : 0
  return clamp01((atZero - value) / (atZero - atFull))
}

/** Points earned for a mechanical metric. */
export function earnedPoints(maxPoints: number, component: number): number {
  return Math.round(maxPoints * clamp01(component))
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

/** Median absolute deviation, scaled to be comparable with a standard deviation. */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0
  const centre = median(values)
  return 1.4826 * median(values.map((value) => Math.abs(value - centre)))
}

export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}
