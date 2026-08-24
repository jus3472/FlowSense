'use client'

import { Disclosure } from '@/components/ui/disclosure'
import { formatDuration } from '@/lib/recording/format'
import type { DeliveryStatistics } from '@/lib/scoring/mechanical'

function Row({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-muted text-sm">{label}</span>
        <span className="numeric text-foreground shrink-0 text-sm">{value}</span>
      </div>
      {/* Details sit directly beneath their own row, indented and attached to it. */}
      {children ? (
        <ul className="border-border ml-3 flex flex-col gap-1 border-l pl-3">{children}</ul>
      ) : null}
    </div>
  )
}

const CATEGORY_LABEL: Record<string, string> = {
  filler: 'Fillers',
  false_start: 'False starts',
  closer: 'Closing hedges',
}

export function StatisticsSection({ statistics }: { statistics: DeliveryStatistics }) {
  const grouped = new Map<string, typeof statistics.counted_items>()
  for (const item of statistics.counted_items) {
    grouped.set(item.category, [...(grouped.get(item.category) ?? []), item])
  }

  return (
    <Disclosure summary="Statistics" hint="Measured but never scored">
      <Row label="Word count" value={`${statistics.word_count}`} />
      <Row label="Recording length" value={formatDuration(statistics.recording_ms)} />
      <Row label="Clean pauses" value={`${statistics.clean_pause_count}`} />
      <Row label="Total silence" value={formatDuration(statistics.total_silence_ms)} />
      <Row label="Silence ratio" value={`${Math.round(statistics.silence_ratio * 100)}%`} />
      <Row label="Longest pause" value={`${(statistics.longest_pause_ms / 1000).toFixed(1)}s`} />
      <Row label="Pace variance" value={`${statistics.pace_variance.toFixed(1)} wpm`} />

      <Row label="Repeated phrases" value={`${statistics.repeated_phrases.length}`}>
        {statistics.repeated_phrases.map((phrase) => (
          <li key={phrase.phrase} className="text-muted text-xs">
            {`"${phrase.phrase}"`} <span className="numeric">x{phrase.count}</span>
          </li>
        ))}
      </Row>

      <Row label="Backtracks" value={`${statistics.backtrack_count}`}>
        {statistics.backtrack_note ? (
          <li className="text-muted text-xs">{statistics.backtrack_note}</li>
        ) : null}
      </Row>

      {/*
        Tokens, not entries. "you know" is one entry and two tokens, and the
        number here is the one the Filler words metric counted, so each entry
        that covers more than one token says so and the list adds up on screen.
      */}
      <Row
        label="Counted tokens"
        value={`${statistics.counted_items.reduce((sum, item) => sum + item.token_indices.length, 0)}`}
      >
        {[...grouped.entries()].map(([category, items]) => (
          <li key={category} className="flex flex-col gap-1">
            <span className="text-muted text-xs font-medium">
              {CATEGORY_LABEL[category] ?? category}
            </span>
            <ul className="flex flex-col gap-1 pl-3">
              {items.map((item, index) => (
                <li key={`${item.text}-${index}`} className="text-muted text-xs">
                  {`"${item.text}"`}
                  {item.token_indices.length > 1 ? (
                    <span className="numeric"> {item.token_indices.length} tokens</span>
                  ) : null}{' '}
                  <span className="numeric">{item.start.toFixed(1)}s</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </Row>
    </Disclosure>
  )
}
