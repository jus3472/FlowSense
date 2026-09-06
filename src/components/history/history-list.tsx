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
import { Card } from '@/components/ui/card'
import { buttonClasses } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FIELD_CONTROL_CLASS } from '@/components/ui/text-field'
import { deleteAttempt } from '@/lib/results/api'
import {
  METADATA_FILTER_LABEL,
  DEFAULT_HISTORY_QUERY,
  groupByDay,
  historyContext,
  historyHref,
  historyLessonResultLabel,
  historyScoreLabel,
  historyStarsLabel,
  timeLabel,
  type HistoryEntry,
  type HistoryMetadataFilter,
  type HistoryQuery,
} from '@/lib/results/history'
import { attemptHref } from '@/lib/routes'
import { cn } from '@/lib/utils'

const METADATA_FILTERS: HistoryMetadataFilter[] = [
  'all',
  'general',
  'interview',
  'presentation',
  'conversation',
  'custom',
  'retry',
]

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

const ICON_BUTTON =
  'text-muted hover:bg-surface-sunken hover:text-foreground flex size-11 items-center justify-center rounded-full transition duration-150 ease-out disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60'

export function HistoryList({
  entries: initial,
  focusPhrase,
  renderedAt,
  timezone,
  query = DEFAULT_HISTORY_QUERY,
  hasAnyEntries = initial.length > 0,
  hasPrevious = false,
  hasNext = false,
}: {
  entries: HistoryEntry[]
  focusPhrase: string
  renderedAt: string
  timezone: string
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
  const groups = groupByDay(entries, new Date(renderedAt), timezone)

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
      <Card className="p-4 sm:p-6">
        <label
          className="text-foreground flex flex-col gap-2 text-sm font-medium"
          htmlFor="history-metadata-filter"
        >
          Show responses
          <select
            id="history-metadata-filter"
            value={query.metadata}
            onChange={(event) =>
              router.push(
                historyHref({
                  metadata: event.target.value as HistoryMetadataFilter,
                  page: 1,
                }),
              )
            }
            className={FIELD_CONTROL_CLASS}
          >
            {METADATA_FILTERS.map((value) => (
              <option key={value} value={value}>
                {METADATA_FILTER_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </Card>

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
          <h2 className="bg-background border-border text-muted sticky top-0 z-10 border-b py-2 text-sm font-medium">
            {group.label}
          </h2>

          <ul className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <li key={entry.id} className="relative">
                <Link
                  href={attemptHref(entry.id)}
                  aria-hidden={confirming === entry.id || undefined}
                  tabIndex={confirming === entry.id ? -1 : undefined}
                  className="border-border bg-surface shadow-card rounded-card hover:bg-surface-sunken focus:ring-accent flex min-h-20 cursor-pointer items-start justify-between gap-4 border p-6 pr-16 transition duration-150 ease-out focus:ring-2 focus:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    {entry.lesson ? (
                      <p className="text-muted text-xs font-medium">{entry.lesson.pathTitle}</p>
                    ) : null}
                    <p className="text-foreground min-w-0 text-sm font-medium break-words">
                      {entry.promptText?.trim() ? entry.promptText : 'Prompt unavailable'}
                    </p>
                    {entry.lesson ? (
                      <p className="text-muted mt-1 text-xs">
                        {`${entry.lesson.chapterLevel[0]?.toUpperCase()}${entry.lesson.chapterLevel.slice(1)} · Lesson ${entry.lesson.lessonPosition}`}
                      </p>
                    ) : null}
                    {historyContext(entry).length > 0 ? (
                      <p className="text-muted mt-1 text-xs">{historyContext(entry).join(' · ')}</p>
                    ) : null}
                    <time
                      dateTime={entry.createdAt}
                      className="numeric text-muted mt-1 block text-xs"
                    >
                      {timeLabel(entry.createdAt, timezone)}
                    </time>
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <span
                      className={cn(
                        'numeric text-foreground shrink-0 text-right',
                        entry.score === null ? 'w-24 text-xs' : 'w-12 text-lg',
                      )}
                    >
                      {historyScoreLabel(entry)}
                    </span>
                    {historyStarsLabel(entry) ? (
                      <span
                        aria-label={`${entry.lesson?.stars ?? 0} stars`}
                        className="text-accent text-xs"
                      >
                        {historyStarsLabel(entry)}
                      </span>
                    ) : null}
                    {historyLessonResultLabel(entry) ? (
                      <span className="text-muted text-xs">{historyLessonResultLabel(entry)}</span>
                    ) : null}
                  </span>
                </Link>

                {confirming === entry.id ? null : (
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

      {confirming ? (
        <div className="bg-foreground/20 fixed inset-0 z-50 flex items-center justify-center p-4">
          <Card
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`delete-confirmation-${confirming}`}
            aria-describedby={`delete-confirmation-description-${confirming}`}
            aria-busy={busy === confirming || undefined}
            onKeyDown={trapConfirmationFocus}
            className="shadow-float max-w-form flex w-full flex-col gap-6"
          >
            <div className="flex flex-col gap-2">
              <h2
                id={`delete-confirmation-${confirming}`}
                className="text-foreground text-lg font-semibold"
              >
                Delete this response?
              </h2>
              <p
                id={`delete-confirmation-description-${confirming}`}
                className="text-muted text-sm"
              >
                This response, its recording, and its score will be permanently deleted. Your
                Progress, streak, stars, and lesson unlocks may change.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                ref={cancelDeleteButtonRef}
                type="button"
                aria-label="Cancel delete"
                aria-disabled={busy === confirming || undefined}
                onClick={() => {
                  if (busy !== confirming) dismissConfirmation(confirming, true)
                }}
                className={buttonClasses({ variant: 'secondary' })}
              >
                Cancel
              </button>
              <button
                ref={confirmDeleteButtonRef}
                type="button"
                aria-label="Confirm delete"
                aria-disabled={busy === confirming || undefined}
                onClick={() => void remove(confirming)}
                className={buttonClasses({
                  variant: 'destructive',
                })}
              >
                {busy === confirming ? 'Deleting response' : 'Delete response'}
              </button>
            </div>
          </Card>
        </div>
      ) : null}

      {hasPrevious || hasNext ? (
        <nav aria-label="History pages" className="flex items-center justify-between gap-3">
          {hasPrevious ? (
            <Link
              href={historyHref({ ...query, page: query.page - 1 })}
              className={buttonClasses({ variant: 'secondary' })}
            >
              Newer responses
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link
              href={historyHref({ ...query, page: query.page + 1 })}
              className={buttonClasses({ variant: 'secondary' })}
            >
              Older responses
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
