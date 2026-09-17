interface ScoreProgressProps {
  value: number | null
  max: number
  label: string
  size?: 'overall' | 'section' | 'metric'
  tone?: 'overall' | 'content' | 'delivery'
  emptyText?: 'Unavailable' | 'Not checked'
}

/**
 * A literal earned/max proportion. Missing or invalid scores stay empty and
 * omit aria-valuenow so assistive technology never receives fabricated progress.
 */
export function ScoreProgress({
  value,
  max,
  label,
  size = 'metric',
  tone = 'overall',
  emptyText = 'Unavailable',
}: ScoreProgressProps) {
  const available =
    value !== null &&
    Number.isFinite(value) &&
    Number.isFinite(max) &&
    max > 0 &&
    value >= 0 &&
    value <= max
  const percentage = available ? (value / max) * 100 : null
  const height = size === 'metric' ? 'h-1' : 'h-2'
  const fill = {
    overall: 'from-score-fill-start to-score-fill-end bg-linear-to-r',
    content: 'from-score-content to-score-overall bg-linear-to-r',
    delivery: 'from-score-overall to-score-delivery bg-linear-to-r',
  }[tone]

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={available ? 0 : undefined}
      aria-valuemax={available ? max : undefined}
      aria-valuenow={available ? value : undefined}
      aria-valuetext={available ? `${value} of ${max}` : emptyText}
      data-state={available ? 'available' : 'unavailable'}
      className={`bg-score-track w-full overflow-hidden rounded-full ${height}`}
    >
      {percentage !== null ? (
        <span
          aria-hidden="true"
          className={`${fill} block h-full rounded-full`}
          style={{ width: `${percentage}%` }}
        />
      ) : null}
    </div>
  )
}
