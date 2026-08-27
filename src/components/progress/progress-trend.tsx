import type { ProgressSeries } from '@/lib/progress/aggregation'

export function ProgressTrend({ label, series }: { label: string; series: ProgressSeries }) {
  const points = series.points.slice(-12)
  const values = points.map((point) => point.value)
  const text = values.length
    ? values.map((value) => Math.round(value)).join(' to ')
    : 'not enough data'
  return (
    <div
      aria-label={`${label} trend: ${text}`}
      role="img"
      className="flex min-h-16 items-end gap-1"
      data-values={values.join(',')}
    >
      {points.map((point) => (
        <span
          key={point.attemptId}
          className="bg-accent-soft w-full rounded-t-sm"
          style={{ height: `${Math.max(4, point.value)}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
