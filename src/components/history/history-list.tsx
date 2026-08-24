'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AudioPlayer } from '@/components/record/audio-player'
import { TrendChart } from '@/components/history/trend-chart'
import { Button } from '@/components/ui/button'
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

export function HistoryList({
  entries: initial,
  focusPhrase,
}: {
  entries: HistoryEntry[]
  focusPhrase: string
}) {
  const [entries, setEntries] = useState(initial)
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [playing, setPlaying] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visible = applyFilter(entries, filter)
  const groups = groupByDay(visible)
  const scores = [...entries].reverse().map((entry) => entry.score)

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

      <div role="group" aria-label="Filter responses" className="flex gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'min-h-11 rounded-full px-4 text-sm font-medium transition duration-150 ease-out',
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
              <li key={entry.id} className="bg-surface rounded-card flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {entry.promptText}
                    </p>
                    <p className="text-muted text-xs">{entry.summary}</p>
                  </div>
                  <span className="numeric text-foreground shrink-0 text-lg">{entry.score}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {entry.audioUrl ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setPlaying((current) => (current === entry.id ? null : entry.id))
                      }
                    >
                      {playing === entry.id ? 'Hide' : 'Play'}
                    </Button>
                  ) : null}
                  <Link
                    href={`/attempts/${entry.id}`}
                    className="text-foreground hover:bg-surface-sunken flex min-h-11 items-center rounded-full px-6 text-sm font-medium transition duration-150 ease-out"
                  >
                    Open
                  </Link>

                  {confirming === entry.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-muted text-xs">
                        Delete this response and its audio?
                      </span>
                      <Button
                        variant="secondary"
                        loading={busy === entry.id}
                        loadingLabel="Deleting"
                        onClick={() => void remove(entry.id)}
                      >
                        Delete
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirming(entry.id)}>
                      Delete
                    </Button>
                  )}
                </div>

                {playing === entry.id && entry.audioUrl ? (
                  <AudioPlayer
                    key={entry.audioUrl}
                    src={entry.audioUrl}
                    durationMs={entry.durationMs}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
