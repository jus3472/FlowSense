import type { ProgressPoint } from '@/lib/progress/v3-aggregation'

export const PROGRESS_CHART_WIDTH = 240
export const PROGRESS_CHART_HEIGHT = 72
const CHART_PADDING_X = 6
const CHART_PADDING_Y = 6

export interface ProgressChartCoordinate {
  attemptId: string
  x: number
  y: number
  value: number
}

/** Keeps trend geometry chronological while listing response details newest first. */
export function newestFirstProgressPoints(
  points: readonly ProgressPoint[],
): readonly ProgressPoint[] {
  return [...points].sort(
    (left, right) =>
      Date.parse(right.finishedAt) - Date.parse(left.finishedAt) ||
      right.attemptId.localeCompare(left.attemptId),
  )
}

function rounded(value: number): number {
  return Number(value.toFixed(2))
}

/** Maps chronological 0-100 observations onto one fixed, compact SVG view box. */
export function progressChartCoordinates(
  points: readonly ProgressPoint[],
): ProgressChartCoordinate[] {
  const valid = points.filter(
    (point) => Number.isFinite(point.value) && point.value >= 0 && point.value <= 100,
  )
  const usableWidth = PROGRESS_CHART_WIDTH - CHART_PADDING_X * 2
  const usableHeight = PROGRESS_CHART_HEIGHT - CHART_PADDING_Y * 2

  return valid.map((point, index) => ({
    attemptId: point.attemptId,
    x:
      valid.length === 1
        ? PROGRESS_CHART_WIDTH / 2
        : rounded(CHART_PADDING_X + (index / (valid.length - 1)) * usableWidth),
    y: rounded(CHART_PADDING_Y + (1 - point.value / 100) * usableHeight),
    value: point.value,
  }))
}

export function progressChartPath(coordinates: readonly ProgressChartCoordinate[]): string {
  return coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
}
