import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

/** Oldest to newest. Bars are scaled against the full 0 to 100 range. */
export function TrendStrip({ scores }: { scores: number[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-muted text-sm font-medium">Trend</h2>
      {scores.length < 2 ? (
        <EmptyState
          title="Not enough responses yet"
          description="Your trend appears after 2 scored responses."
        />
      ) : (
        <div className="flex h-16 items-end gap-1" aria-hidden="true">
          {scores.map((score, index) => (
            <div
              key={index}
              className="bg-accent flex-1 rounded-full"
              style={{ height: `${Math.max(score, 4)}%` }}
            />
          ))}
        </div>
      )}
      {scores.length >= 2 ? (
        <p className="numeric text-muted text-xs">
          {scores.length} responses, most recent on the right
        </p>
      ) : null}
    </Card>
  )
}
