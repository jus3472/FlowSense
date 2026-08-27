import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { attemptHref } from '@/lib/routes'

interface LastScoreProps {
  attemptId: string | null
  score: number | null
  summary: string | null
  focusPhrase: string
}

export function LastScore({ attemptId, score, summary, focusPhrase }: LastScoreProps) {
  if (!attemptId) {
    return (
      <Card className="flex flex-col gap-6 p-8">
        <h2 className="section-label text-muted">Last response</h2>
        <EmptyState
          title="No score yet"
          description={`Answer one prompt and you will see how you sound ${focusPhrase}.`}
        />
      </Card>
    )
  }

  return (
    <Link
      href={attemptHref(attemptId)}
      className="bg-surface rounded-card hover:bg-surface-sunken flex flex-col gap-6 p-8 transition duration-150 ease-out"
    >
      <h2 className="section-label text-muted">Last response</h2>
      {score === null ? (
        <p className="text-foreground text-base font-medium">Overall unavailable</p>
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="prompt-display text-foreground text-2xl">{score}</span>
          <span className="numeric text-muted text-sm">/ 100</span>
        </div>
      )}
      {summary ? <p className="text-muted text-base">{summary}</p> : null}
    </Link>
  )
}
