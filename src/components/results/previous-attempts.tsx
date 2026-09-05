import type { Route } from 'next'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import type { LessonAttemptHistoryItem } from '@/lib/results/lesson-attempt-history'

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const ACCESSIBLE_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})

function attemptLabel(attempt: LessonAttemptHistoryItem): string {
  const date = new Date(attempt.finishedAt)
  const time = `${ACCESSIBLE_DATE_FORMAT.format(date)} at ${TIME_FORMAT.format(date)}`
  return attempt.score === null
    ? `View unavailable attempt from ${time}`
    : `View attempt scored ${attempt.score} out of 100 from ${time}`
}

export function PreviousAttempts({ attempts }: { attempts: readonly LessonAttemptHistoryItem[] }) {
  if (attempts.length === 0) return null

  return (
    <section aria-labelledby="previous-attempts-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="previous-attempts-heading" className="prompt-display text-foreground text-xl">
        Previous attempts
      </h2>
      <Card className="overflow-hidden p-0">
        <ul className="divide-border divide-y">
          {attempts.map((attempt) => {
            const date = new Date(attempt.finishedAt)
            return (
              <li key={attempt.attemptId}>
                <Link
                  href={`/attempts/${encodeURIComponent(attempt.attemptId)}` as Route}
                  aria-label={attemptLabel(attempt)}
                  className="hover:bg-surface-sunken focus-visible:bg-surface-sunken flex min-h-11 min-w-0 flex-col justify-center gap-1 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <span className="numeric text-foreground font-medium">
                    {attempt.score === null ? 'Overall unavailable' : `${attempt.score} / 100`}
                  </span>
                  <time dateTime={attempt.finishedAt} className="text-muted text-sm">
                    {DATE_FORMAT.format(date)} · {TIME_FORMAT.format(date)}
                  </time>
                </Link>
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}
