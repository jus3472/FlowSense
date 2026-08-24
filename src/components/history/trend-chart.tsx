/** Scores over time with a quiet band at the average. No axes, no chrome. */
export function TrendChart({ scores, average }: { scores: number[]; average: number }) {
  if (scores.length < 2) return null

  const width = 320
  const height = 72
  const step = width / (scores.length - 1)
  const y = (score: number) => height - (score / 100) * height

  const points = scores.map((score, index) => `${index * step},${y(score)}`).join(' ')
  const bandHeight = 8
  const bandTop = Math.max(0, Math.min(height - bandHeight, y(average) - bandHeight / 2))

  return (
    <div className="bg-surface rounded-card flex flex-col gap-3 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-muted text-sm font-medium">Scores over time</h2>
        <p className="numeric text-muted text-xs">average {Math.round(average)}</p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Scores over time, averaging ${Math.round(average)} out of 100`}
        className="h-[72px] w-full"
      >
        <rect x="0" y={bandTop} width={width} height={bandHeight} className="fill-accent-soft" />
        <polyline
          points={points}
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-accent"
        />
      </svg>
    </div>
  )
}
