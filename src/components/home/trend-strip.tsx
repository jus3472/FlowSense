import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

/** Oldest to newest, most recent on the right. No axes, no chrome. */
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

  return (
    <Link
      href="/history"
      className="bg-surface rounded-card hover:bg-surface-sunken flex flex-col gap-6 p-8 transition duration-150 ease-out"
    >
      <h2 className="section-label text-muted">Trend</h2>
      <div aria-hidden="true" className="flex h-12 items-end gap-2">
        {recent.map((score, index) => (
          <span key={index} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span
              className="bg-accent block size-2 rounded-full"
              style={{ marginBottom: `${(score / 100) * 32}px` }}
            />
          </span>
        ))}
      </div>
      <p className="numeric text-muted text-xs">{recent.length} most recent, oldest on the left</p>
    </Link>
  )
}
