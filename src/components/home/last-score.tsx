import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

interface LastScoreProps {
  score: number | null
  recordedAt: string | null
  focusPhrase: string
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

export function LastScore({ score, recordedAt, focusPhrase }: LastScoreProps) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-muted text-sm font-medium">Last score</h2>
      {score === null ? (
        <EmptyState
          title="No score yet"
          description={`Answer one prompt and you will see how you sound ${focusPhrase}.`}
        />
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="numeric text-foreground text-2xl font-medium">{score}</span>
          <span className="numeric text-muted text-sm">/ 100</span>
          {recordedAt ? (
            <span className="numeric text-muted ml-auto text-xs">
              {DATE_FORMAT.format(new Date(recordedAt))}
            </span>
          ) : null}
        </div>
      )}
    </Card>
  )
}
