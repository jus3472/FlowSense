'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import { Card } from '@/components/ui/card'
import {
  PROGRESS_CHART_HEIGHT,
  PROGRESS_CHART_WIDTH,
  progressChartCoordinates,
  progressChartPath,
} from '@/lib/progress/chart'
import { PROGRESS_FILTER_LABELS } from '@/lib/progress/display'
import {
  performancePoints,
  type ProgressPoint,
  type ProgressSeries,
} from '@/lib/progress/v3-aggregation'
import { attemptHref } from '@/lib/routes'
import type { V3MetricId } from '@/lib/scoring/v3/contracts'
import { safeTimezone } from '@/lib/timezone'
import { cn } from '@/lib/utils'

function displayValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function dateLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function pointContext(point: ProgressPoint): string {
  return [PROGRESS_FILTER_LABELS[point.mode], point.retryOfAttemptId ? 'Retry' : null]
    .filter((value): value is string => value !== null)
    .join(' · ')
}

function scoreLabel(point: ProgressPoint): string {
  const earned = displayValue(point.earnedPoints)
  const maximum = displayValue(point.maxPoints)
  const performance = displayValue(point.value)
  return point.maxPoints === 100 && point.earnedPoints === point.value
    ? `${earned} / ${maximum}`
    : `${earned} / ${maximum} · ${performance}%`
}

function measurement(point: ProgressPoint, key: string): number | null {
  const value = point.raw?.measurements?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rawContext(point: ProgressPoint, metric?: V3MetricId): string | null {
  if (metric === 'pace') {
    const wpm = measurement(point, 'words_per_minute')
    return wpm === null ? null : `${Math.round(wpm)} WPM`
  }
  if (metric === 'paused_time') {
    const milliseconds = measurement(point, 'total_unnatural_pause_ms')
    return milliseconds === null
      ? null
      : `${(milliseconds / 1_000).toFixed(1)}s excessive paused time`
  }
  if (metric === 'articulation') {
    const proportion = measurement(point, 'low_confidence_proportion')
    return proportion === null ? null : `${Math.round(proportion * 100)}% lower-confidence words`
  }
  if (metric === 'energy') {
    const pitchRange = measurement(point, 'pitch_range_semitones')
    return pitchRange === null ? null : `${pitchRange.toFixed(1)} semitone pitch range`
  }
  return null
}

function PerformanceChart({
  label,
  points,
  expanded = false,
  prominent = false,
}: {
  label: string
  points: readonly ProgressPoint[]
  expanded?: boolean
  prominent?: boolean
}) {
  const coordinates = progressChartCoordinates(points)
  const path = progressChartPath(coordinates)
  const values = points.map((point) => displayValue(point.value)).join(' to ')

  if (coordinates.length === 0) {
    return <p className="text-muted text-xs">No checked results in this view.</p>
  }

  const accessibleSummary = expanded
    ? `${label} full trend with ${points.length} responses on a fixed 0 to 100 scale. Oldest ${displayValue(points[0]!.value)}%, latest ${displayValue(points.at(-1)!.value)}%.`
    : `${label} from oldest to latest: ${values}`

  return (
    <div className={cn('flex min-w-0 gap-2', expanded && 'items-stretch')}>
      {expanded ? (
        <span
          aria-hidden="true"
          className="numeric text-muted flex h-40 shrink-0 flex-col justify-between py-1 text-xs"
        >
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </span>
      ) : null}
      <svg
        viewBox={`0 0 ${PROGRESS_CHART_WIDTH} ${PROGRESS_CHART_HEIGHT}`}
        role="img"
        aria-label={accessibleSummary}
        className={cn('w-full min-w-0', expanded ? 'h-40' : prominent ? 'h-24' : 'h-16')}
        data-chart-size={expanded ? 'expanded' : 'compact'}
        data-values={points.map((point) => point.value).join(',')}
      >
        {[6, 36, 66].map((y) => (
          <line
            key={y}
            x1="0"
            x2={PROGRESS_CHART_WIDTH}
            y1={y}
            y2={y}
            className="text-border"
            stroke="currentColor"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {coordinates.length > 1 ? (
          <path
            d={path}
            fill="none"
            className="text-accent"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {coordinates.map((point) => (
          <circle
            key={point.attemptId}
            cx={point.x}
            cy={point.y}
            r={expanded ? 2.5 : 3}
            className="text-accent"
            fill="currentColor"
          />
        ))}
      </svg>
    </div>
  )
}

function ExpandedHistory({
  label,
  points,
  timezone,
  metric,
}: {
  label: string
  points: readonly ProgressPoint[]
  timezone: string
  metric?: V3MetricId
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <PerformanceChart label={label} points={points} expanded />
      <ol aria-label={`${label} response history`} className="divide-border divide-y">
        {points.map((point) => {
          const measurementLabel = rawContext(point, metric)
          return (
            <li key={point.attemptId}>
              <Link
                href={attemptHref(point.attemptId)}
                className="hover:bg-surface-sunken focus-visible:bg-surface-sunken flex min-h-11 min-w-0 flex-col gap-3 px-2 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-3"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-foreground text-sm font-medium break-words">
                    {point.promptText.trim() || 'Prompt unavailable'}
                  </span>
                  <span className="text-muted text-xs">{pointContext(point)}</span>
                  <time dateTime={point.finishedAt} className="text-muted text-xs">
                    {dateLabel(point.finishedAt, timezone)}
                  </time>
                </span>
                <span className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                  <span className="numeric text-foreground text-sm">{scoreLabel(point)}</span>
                  {measurementLabel ? (
                    <span className="numeric text-muted text-xs">{measurementLabel}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function ProgressTrend({
  label,
  series,
  timezone,
  metric,
  size = 'metric',
}: {
  label: string
  series: ProgressSeries
  timezone: string
  metric?: V3MetricId
  size?: 'overview' | 'metric'
}) {
  const [open, setOpen] = useState(false)
  const historyId = useId()
  const compact = performancePoints(series, 'compact')
  const expanded = performancePoints(series, 'expanded')
  const latest = series.points.at(-1) ?? null

  return (
    <Card className={cn('min-w-0 overflow-hidden p-0', open && 'sm:col-span-full')}>
      <button
        type="button"
        aria-label={`${open ? 'Hide' : 'View'} ${label} response history`}
        aria-expanded={expanded.length === 0 ? undefined : open}
        aria-controls={expanded.length === 0 ? undefined : historyId}
        disabled={expanded.length === 0}
        onClick={() => setOpen((value) => !value)}
        className="hover:bg-surface-sunken rounded-card flex min-h-11 w-full min-w-0 flex-col gap-4 p-4 text-left transition duration-150 ease-out disabled:cursor-default sm:p-6"
      >
        <span className="flex w-full min-w-0 items-start justify-between gap-4">
          <span className="text-foreground font-medium break-words">{label}</span>
          <span className="numeric text-foreground shrink-0 text-right text-sm">
            {latest === null ? 'Unavailable' : scoreLabel(latest)}
          </span>
        </span>
        <span className={cn('block w-full', size === 'overview' && 'py-2')}>
          <PerformanceChart label={label} points={compact} prominent={size === 'overview'} />
        </span>
        <span className="text-muted flex w-full items-center justify-between gap-3 text-xs">
          <span>
            {series.observationCount === 0
              ? 'No response history'
              : series.observationCount === 1
                ? 'One response. Add another to see a trend.'
                : `${series.observationCount} responses from oldest to latest`}
          </span>
          <span aria-hidden="true" className={open ? 'rotate-180' : undefined}>
            ▾
          </span>
        </span>
      </button>
      {open ? (
        <div
          id={historyId}
          role="region"
          aria-label={`${label} response history`}
          className="border-border border-t"
        >
          <ExpandedHistory label={label} points={expanded} timezone={timezone} metric={metric} />
        </div>
      ) : null}
    </Card>
  )
}
