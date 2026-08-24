import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

/** A compact, literal view of recent scores. Oldest is on the left. */
export function TrendStrip({ scores }: { scores: number[] }) {
  if (scores.length < 2) {
    return (
      <Card className="flex flex-col gap-6 p-8">
        <h2 className="section-label text-muted">Trend</h2>
        <EmptyState
          title="Not enough responses yet"
          description="Your trend appears after 2 scored responses."
        />
      </Card>
    )
  }

  const recent = scores.slice(-7)
  const width = 320
  const height = 72
  const inset = 6
  const step = width / (recent.length - 1)
  const y = (score: number) => height - inset - (score / 100) * (height - inset * 2)
  const points = recent.map((score, index) => `${index * step},${y(score)}`).join(' ')
  const latest = recent[recent.length - 1]

  return (
    <Link
      href="/history"
      className="bg-surface rounded-card hover:bg-surface-sunken focus:ring-accent-soft flex flex-col gap-4 p-6 transition duration-150 ease-out focus:ring-2"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="section-label text-muted">Recent scores</h2>
        <p className="numeric text-muted text-xs">latest {latest}</p>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Recent scores from oldest to latest: ${recent.join(', ')}`}
        className="h-[72px] w-full"
      >
        <polyline
          points={points}
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-accent"
        />
        {recent.map((score, index) => (
          <circle
            key={`${score}-${index}`}
            cx={index * step}
            cy={y(score)}
            r="3"
            className="fill-accent"
          />
        ))}
      </svg>

      <div className="numeric text-muted flex justify-between gap-2 text-xs">
        {recent.map((score, index) => (
          <span key={`${score}-${index}`}>{score}</span>
        ))}
      </div>

      <div className="text-muted flex justify-between text-xs">
        <span>Oldest</span>
        <span>Most recent</span>
      </div>
    </Link>
  )
}
