'use client'

import type { Route } from 'next'
import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { ModalLayer } from '@/components/ui/modal-layer'
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

function AttemptLink({
  attempt,
  timezone,
  onClick,
  compact = false,
}: {
  attempt: LessonAttemptHistoryItem
  timezone: string
  onClick?: () => void
  compact?: boolean
}) {
  const date = new Date(attempt.finishedAt)

  return (
    <Link
      href={`/attempts/${encodeURIComponent(attempt.attemptId)}` as Route}
      aria-label={attemptLabel(attempt, timezone)}
      onClick={onClick}
      className={cn(
        'hover:bg-surface-sunken focus-visible:bg-surface-sunken flex min-h-11 min-w-0 flex-col justify-center gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        compact ? 'px-4 py-2' : 'px-6 py-4',
      )}
    >
      <span className="numeric text-foreground font-medium">
        {attempt.score === null ? 'Overall unavailable' : `${attempt.score} / 100`}
      </span>
      <time dateTime={attempt.finishedAt} className="text-muted text-sm">
        {dateFormat(timezone, 'short').format(date)} · {timeFormat(timezone).format(date)}
      </time>
    </Link>
  )
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
  const [open, setOpen] = useState(false)
  const id = useId()
  const dialogId = `${id}-dialog`
  const titleId = `${id}-title`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const orderedAttempts = [...attempts].sort((left, right) =>
    right.finishedAt.localeCompare(left.finishedAt),
  )
  const latestAttempt = orderedAttempts[0]

  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [close, open])

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!latestAttempt) return null

  return (
    <>
      <section
        aria-labelledby="previous-attempts-heading"
        className={cn('flex min-w-0 flex-col', className)}
      >
        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden p-0!">
          <div className="border-border border-b px-4 py-3">
            <CardTitle id="previous-attempts-heading">Previous attempts</CardTitle>
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <AttemptLink attempt={latestAttempt} timezone={timezone} compact />
          </div>
          {orderedAttempts.length > 1 ? (
            <div className="border-border border-t px-4 py-2">
              <Button
                ref={triggerRef}
                variant="secondary"
                fullWidth
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={dialogId}
                onClick={() => setOpen(true)}
              >
                View all attempts
              </Button>
            </div>
          ) : null}
        </Card>
      </section>

      {open ? (
        <ModalLayer
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <Card
            ref={dialogRef}
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={trapFocus}
            className="border-border bg-surface shadow-float rounded-card max-w-column flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden border p-0"
          >
            <div className="border-border flex items-start justify-between gap-6 border-b p-4 sm:p-6">
              <h2 id={titleId} className="text-foreground text-lg font-semibold">
                All previous attempts
              </h2>
              <Button ref={closeRef} variant="ghost" className="shrink-0" onClick={close}>
                Close
              </Button>
            </div>
            <div className="min-h-0 overflow-y-auto">
              <ul className="divide-border divide-y">
                {orderedAttempts.map((attempt) => (
                  <li key={attempt.attemptId}>
                    <AttemptLink attempt={attempt} timezone={timezone} onClick={close} />
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </ModalLayer>
      ) : null}
    </>
  )
}
