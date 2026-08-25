'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TrendChart } from '@/components/history/trend-chart'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { deleteAttempt } from '@/lib/results/api'
import {
  FILTER_LABEL,
  applyFilter,
  averageScore,
  groupByDay,
  type HistoryEntry,
  type HistoryFilter,
} from '@/lib/results/history'
import { cn } from '@/lib/utils'

const FILTERS: HistoryFilter[] = ['all', 'high', 'low']

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
    >
      <path d="M4.5 6.5h11M8 3.5h4m-6.5 3 1 10h7l1-10M8.5 9v4.5m3-4.5v4.5" strokeWidth="1.5" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
    >
      <path d="m6 6 8 8m0-8-8 8" strokeWidth="1.5" />
    </svg>
  )
}

const ICON_BUTTON =
  'text-muted hover:bg-surface-sunken hover:text-foreground flex size-11 items-center justify-center rounded-full transition duration-150 ease-out disabled:pointer-events-none disabled:opacity-60'

export function HistoryList({
  entries: initial,
  focusPhrase,
}: {
  entries: HistoryEntry[]
  focusPhrase: string
}) {
  const [entries, setEntries] = useState(initial)
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusAfterDismissRef = useRef<string | null>(null)

  const visible = applyFilter(entries, filter)
  const groups = groupByDay(visible)
  const scores = [...entries].reverse().map((entry) => entry.score)

  const dismissConfirmation = useCallback((id: string, returnFocus: boolean) => {
    if (returnFocus) focusAfterDismissRef.current = id
    setConfirming(null)
  }, [])

  useEffect(() => {
    if (!focusAfterDismissRef.current || confirming !== null) return

    deleteButtonRefs.current.get(focusAfterDismissRef.current)?.focus()
    focusAfterDismissRef.current = null
  }, [confirming])

  useEffect(() => {
    if (!confirming || busy === confirming) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      dismissConfirmation(confirming, true)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, confirming, dismissConfirmation])

  const remove = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      await deleteAttempt(id)
      setEntries((current) => current.filter((entry) => entry.id !== id))
      setConfirming(null)
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'It could not be deleted.')
    } finally {
      setBusy(null)
    }
  }

  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No responses yet"
          description={`Answer one prompt and it will appear here with how you sound ${focusPhrase}.`}
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <TrendChart scores={scores} average={averageScore(entries)} />

      <div role="group" aria-label="Filter responses" className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'min-h-11 rounded-full px-4 text-sm font-medium whitespace-nowrap transition duration-150 ease-out',
              filter === value
                ? 'bg-accent-soft text-foreground ring-accent ring-2 ring-inset'
                : 'bg-surface-sunken text-foreground hover:bg-accent-soft',
            )}
          >
            {FILTER_LABEL[value]}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-negative text-sm">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing in this filter"
            description="Switch back to all to see every response."
          />
        </Card>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h2 className="bg-background text-muted sticky top-0 z-10 py-2 text-sm font-medium">
            {group.label}
          </h2>

          <ul className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <li key={entry.id} className="relative">
                <Link
                  href={`/attempts/${entry.id}`}
                  className="bg-surface rounded-card hover:bg-surface-sunken focus:ring-accent-soft flex min-h-20 cursor-pointer items-start justify-between gap-4 p-6 pr-16 transition duration-150 ease-out focus:ring-2"
                >
                  <p className="text-foreground min-w-0 flex-1 text-sm font-medium break-words">
                    {entry.promptText}
                  </p>
                  <span className="numeric text-foreground w-12 shrink-0 text-right text-lg">
                    {entry.score}
                  </span>
                </Link>

                {confirming === entry.id ? (
                  <div className="bg-surface rounded-card absolute inset-0 z-10 flex items-center justify-between gap-4 px-6">
                    <p className="text-foreground text-sm">Delete this response?</p>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label="Confirm delete"
                        title="Delete response"
                        disabled={busy === entry.id}
                        onClick={() => void remove(entry.id)}
                        className={ICON_BUTTON}
                      >
                        <TrashIcon />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel delete"
                        title="Cancel"
                        disabled={busy === entry.id}
                        onClick={() => dismissConfirmation(entry.id, false)}
                        className={ICON_BUTTON}
                      >
                        <CloseIcon />
                      </button>
                    </span>
                  </div>
                ) : (
                  <button
                    ref={(node) => {
                      if (node) {
                        deleteButtonRefs.current.set(entry.id, node)
                      } else {
                        deleteButtonRefs.current.delete(entry.id)
                      }
                    }}
                    type="button"
                    aria-label="Delete response"
                    title="Delete response"
                    onClick={() => setConfirming(entry.id)}
                    className={`${ICON_BUTTON} absolute top-4 right-3`}
                  >
                    <TrashIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
