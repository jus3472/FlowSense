import type { ProgressSeries } from '@/lib/progress/v3-aggregation'

export function ProgressTrend({ label, series }: { label: string; series: ProgressSeries }) {
  const points = series.points.slice(-12)
  const values = points.map((point) => point.value)
  const current = values.at(-1)
  const text = values.length
    ? values.map((value) => Math.round(value)).join(' to ')
    : 'not enough data'
  return (
    <div className="flex flex-col gap-3">
      <p className="numeric text-foreground text-lg">
        {current === undefined ? 'Not enough data' : `${Math.round(current)} / 100`}
      </p>
      {series.state === 'ready' ? (
        <div
          aria-label={`${label} trend from oldest to latest: ${text}`}
          role="img"
          className="border-border flex min-h-16 items-end gap-1 border-b"
          data-values={values.join(',')}
        >
          {points.map((point) => (
            <span
              key={point.attemptId}
              className="from-score-fill-start to-score-fill-end w-full rounded-t-sm bg-linear-to-t"
              style={{ height: `${Math.max(4, point.value)}%` }}
              aria-hidden="true"
            />
          ))}
        </div>
      ) : (
        <p className="text-muted text-xs">Complete two compatible responses to see a trend.</p>
      )}
    </div>
  )
}
