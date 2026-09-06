import type { Route } from 'next'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import type { LessonAttemptHistoryItem } from '@/lib/results/lesson-attempt-history'
import { safeTimezone } from '@/lib/timezone'
import { cn } from '@/lib/utils'

function dateFormat(timezone: string, month: 'short' | 'long'): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    month,
    day: 'numeric',
    year: 'numeric',
  })
}

function timeFormat(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    hour: 'numeric',
    minute: '2-digit',
  })
}

function attemptLabel(attempt: LessonAttemptHistoryItem, timezone: string): string {
  const date = new Date(attempt.finishedAt)
  const time = `${dateFormat(timezone, 'long').format(date)} at ${timeFormat(timezone).format(date)}`
  return attempt.score === null
    ? `View unavailable attempt from ${time}`
    : `View attempt scored ${attempt.score} out of 100 from ${time}`
}

export function PreviousAttempts({
  attempts,
  className,
  timezone,
}: {
  attempts: readonly LessonAttemptHistoryItem[]
  className?: string
  timezone: string
}) {
  if (attempts.length === 0) return null

  return (
    <section
      aria-labelledby="previous-attempts-heading"
      className={cn('flex min-w-0 flex-col gap-4', className)}
    >
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
                  aria-label={attemptLabel(attempt, timezone)}
                  className="hover:bg-surface-sunken focus-visible:bg-surface-sunken flex min-h-11 min-w-0 flex-col justify-center gap-1 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <span className="numeric text-foreground font-medium">
                    {attempt.score === null ? 'Overall unavailable' : `${attempt.score} / 100`}
                  </span>
                  <time dateTime={attempt.finishedAt} className="text-muted text-sm">
                    {dateFormat(timezone, 'short').format(date)} ·{' '}
                    {timeFormat(timezone).format(date)}
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
