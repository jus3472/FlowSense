'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { TrendChart } from '@/components/history/trend-chart'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { deleteAttempt } from '@/lib/results/api'
import {
  FILTER_LABEL,
  METADATA_FILTER_LABEL,
  DEFAULT_HISTORY_QUERY,
  groupByDay,
  historyContext,
  historyHref,
  historyScoreLabel,
  timeLabel,
  type HistoryEntry,
  type HistoryFilter,
  type HistoryMetadataFilter,
  type HistoryQuery,
} from '@/lib/results/history'
import type { HistoryScoreSummary } from '@/lib/results/history-cohort'
import { attemptHref } from '@/lib/routes'
import { cn } from '@/lib/utils'

const FILTERS: HistoryFilter[] = ['all', 'high', 'low']
const METADATA_FILTERS: HistoryMetadataFilter[] = [
  'all',
  'general',
  'interview',
  'presentation',
  'conversation',
  'custom',
  'retry',
]

const EMPTY_SCORE_SUMMARY: HistoryScoreSummary = {
  cohort: null,
  points: [],
  average: null,
  scannedCount: 0,
  excludedCount: 0,
  scanLimit: 200,
  truncated: false,
}

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
  'text-muted hover:bg-surface-sunken hover:text-foreground flex size-11 items-center justify-center rounded-full transition duration-150 ease-out disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60'

export function HistoryList({
  entries: initial,
  scoreSummary = EMPTY_SCORE_SUMMARY,
  focusPhrase,
  query = DEFAULT_HISTORY_QUERY,
  hasAnyEntries = initial.length > 0,
  hasPrevious = false,
  hasNext = false,
}: {
  entries: HistoryEntry[]
  scoreSummary?: HistoryScoreSummary
  focusPhrase: string
  query?: HistoryQuery
  hasAnyEntries?: boolean
  hasPrevious?: boolean
  hasNext?: boolean
}) {
  const router = useRouter()
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const historyContainerRef = useRef<HTMLDivElement>(null)
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const confirmDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const cancelDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const focusAfterDismissRef = useRef<string | null>(null)
  const focusAfterDeleteRef = useRef<{ targetId: string | null } | null>(null)

  const entries = initial.filter((entry) => !removedIds.has(entry.id))
  const groups = groupByDay(entries)

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
    if (confirming !== null) confirmDeleteButtonRef.current?.focus()
  }, [confirming])

  useEffect(() => {
    const pending = focusAfterDeleteRef.current
    if (!pending) return

    const nextControl = pending.targetId
      ? deleteButtonRefs.current.get(pending.targetId)
      : undefined
    ;(nextControl ?? historyContainerRef.current)?.focus()
    focusAfterDeleteRef.current = null
  }, [removedIds])

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

  const trapConfirmationFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return

    const confirm = confirmDeleteButtonRef.current
    const cancel = cancelDeleteButtonRef.current
    if (!confirm || !cancel) return

    event.preventDefault()
    if (event.shiftKey) {
      ;(document.activeElement === confirm ? cancel : confirm).focus()
    } else {
      ;(document.activeElement === cancel ? confirm : cancel).focus()
    }
  }

  const remove = async (id: string) => {
    if (busy === id) return
    setBusy(id)
    setError(null)
    try {
      await deleteAttempt(id)
      const removedIndex = entries.findIndex((entry) => entry.id === id)
      focusAfterDeleteRef.current = {
        targetId: entries[removedIndex + 1]?.id ?? entries[removedIndex - 1]?.id ?? null,
      }
      setRemovedIds((current) => new Set(current).add(id))
      setConfirming(null)
      setAnnouncement('Response deleted.')
      router.refresh()
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'It could not be deleted.')
      dismissConfirmation(id, true)
    } finally {
      setBusy(null)
    }
  }

  if (!hasAnyEntries) {
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
    <div
      ref={historyContainerRef}
      role="region"
      tabIndex={-1}
      aria-label="History responses"
      className="focus-visible:ring-accent-soft flex flex-col gap-6 focus-visible:ring-2 focus-visible:outline-none"
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <TrendChart summary={scoreSummary} />

      <div className="flex flex-col gap-3">
        <label className="text-muted flex flex-col gap-1 text-sm" htmlFor="history-metadata-filter">
          Show responses
          <select
            id="history-metadata-filter"
            value={query.metadata}
            onChange={(event) =>
              router.push(
                historyHref({
                  metadata: event.target.value as HistoryMetadataFilter,
                  score: query.score,
                  page: 1,
                }),
              )
            }
            className="bg-surface text-foreground rounded-input min-h-11 px-3 text-sm"
          >
            {METADATA_FILTERS.map((value) => (
              <option key={value} value={value}>
                {METADATA_FILTER_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Filter responses" className="flex flex-wrap gap-2">
          {FILTERS.map((value) => (
            <Link
              key={value}
              href={historyHref({ metadata: query.metadata, score: value, page: 1 })}
              aria-current={query.score === value ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition duration-150 ease-out',
                query.score === value
                  ? 'bg-accent-soft text-foreground ring-accent ring-2 ring-inset'
                  : 'bg-surface-sunken text-foreground hover:bg-accent-soft',
              )}
            >
              {FILTER_LABEL[value]}
            </Link>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-negative text-sm">
          {error}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing in this filter"
            description="Choose another filter to see other responses."
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
                  href={attemptHref(entry.id)}
                  aria-hidden={confirming === entry.id || undefined}
                  tabIndex={confirming === entry.id ? -1 : undefined}
                  className="bg-surface rounded-card hover:bg-surface-sunken focus:ring-accent-soft flex min-h-20 cursor-pointer items-start justify-between gap-4 p-6 pr-16 transition duration-150 ease-out focus:ring-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground min-w-0 text-sm font-medium break-words">
                      {entry.promptText}
                    </p>
                    <p className="text-muted mt-1 text-xs">{historyContext(entry).join(' · ')}</p>
                    <time
                      dateTime={entry.createdAt}
                      className="numeric text-muted mt-1 block text-xs"
                    >
                      {timeLabel(entry.createdAt)}
                    </time>
                  </div>
                  <span
                    className={cn(
                      'numeric text-foreground shrink-0 text-right',
                      entry.score === null ? 'w-24 text-xs' : 'w-12 text-lg',
                    )}
                  >
                    {historyScoreLabel(entry)}
                  </span>
                </Link>

                {confirming === entry.id ? (
                  <div
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby={`delete-confirmation-${entry.id}`}
                    aria-busy={busy === entry.id || undefined}
                    onKeyDown={trapConfirmationFocus}
                    className="bg-surface rounded-card absolute inset-0 z-10 flex items-center justify-between gap-4 px-6"
                  >
                    <p id={`delete-confirmation-${entry.id}`} className="text-foreground text-sm">
                      Delete this response?
                    </p>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        ref={confirmDeleteButtonRef}
                        type="button"
                        aria-label="Confirm delete"
                        aria-disabled={busy === entry.id || undefined}
                        title="Delete response"
                        onClick={() => void remove(entry.id)}
                        className={ICON_BUTTON}
                      >
                        <TrashIcon />
                      </button>
                      <button
                        ref={cancelDeleteButtonRef}
                        type="button"
                        aria-label="Cancel delete"
                        aria-disabled={busy === entry.id || undefined}
                        title="Cancel"
                        onClick={() => {
                          if (busy !== entry.id) dismissConfirmation(entry.id, true)
                        }}
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
                    onClick={() => {
                      setAnnouncement('')
                      setConfirming(entry.id)
                    }}
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

      {hasPrevious || hasNext ? (
        <nav aria-label="History pages" className="flex items-center justify-between gap-3">
          {hasPrevious ? (
            <Link
              href={historyHref({ ...query, page: query.page - 1 })}
              className="bg-surface-sunken text-foreground rounded-full px-4 py-3 text-sm font-medium"
            >
              Newer responses
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link
              href={historyHref({ ...query, page: query.page + 1 })}
              className="bg-surface-sunken text-foreground rounded-full px-4 py-3 text-sm font-medium"
            >
              Older responses
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
