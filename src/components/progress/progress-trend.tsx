'use client'

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
import { Card } from '@/components/ui/card'
import { ModalLayer } from '@/components/ui/modal-layer'
import {
  PROGRESS_CHART_HEIGHT,
  PROGRESS_CHART_WIDTH,
  newestFirstProgressPoints,
  progressChartCoordinates,
  progressChartLabelIndexes,
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

function averageLabel(value: number | null): string {
  return value === null ? 'Unavailable' : `${displayValue(value)}%`
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
  const labelIndexes = new Set(
    expanded ? progressChartLabelIndexes(coordinates.length) : coordinates.map((_, index) => index),
  )
  const values = points.map((point) => displayValue(point.value)).join(' to ')

  if (coordinates.length === 0) {
    return <p className="text-muted text-xs">No checked results in this view.</p>
  }

  const accessibleSummary = expanded
    ? `${label} full trend with ${points.length} responses on a fixed 0 to 100 scale. Values from oldest to latest: ${values}.`
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
            className="text-accent-visual"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {coordinates.map((point, index) => (
          <g key={point.attemptId}>
            <circle
              cx={point.x}
              cy={point.y}
              r={expanded ? 2.5 : 3}
              className="text-accent-visual"
              fill="currentColor"
            />
            {labelIndexes.has(index) ? (
              <text
                x={point.x}
                y={point.y < 18 ? point.y + 12 : point.y - 7}
                textAnchor={
                  index === 0 ? 'start' : index === coordinates.length - 1 ? 'end' : 'middle'
                }
                className="fill-muted numeric text-[9px]"
                aria-hidden="true"
                data-point-label={point.attemptId}
              >
                {displayValue(point.value)}%
              </text>
            ) : null}
          </g>
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
  const newestFirst = newestFirstProgressPoints(points)

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6">
      <PerformanceChart label={label} points={points} expanded />
      <ol aria-label={`${label} response history`} className="divide-border divide-y">
        {newestFirst.map((point) => {
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
  const id = useId()
  const dialogId = `${id}-dialog`
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const compact = performancePoints(series, 'compact')
  const expanded = performancePoints(series, 'expanded')
  const average = averageLabel(series.averageValue)

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

  return (
    <>
      <Card className="h-full min-w-0 overflow-hidden p-0">
        <button
          ref={triggerRef}
          type="button"
          aria-label={`View ${label} response history`}
          aria-haspopup="dialog"
          aria-expanded={expanded.length === 0 ? undefined : open}
          aria-controls={expanded.length === 0 ? undefined : dialogId}
          disabled={expanded.length === 0}
          onClick={() => setOpen(true)}
          className="enabled:hover:bg-surface-sunken rounded-card flex h-full min-h-11 w-full min-w-0 flex-col gap-6 p-4 text-left transition duration-150 ease-out disabled:cursor-default sm:p-6"
        >
          <span
            className={cn(
              'flex w-full min-w-0 items-start justify-between gap-4',
              size === 'overview' &&
                'lg:flex-col lg:items-stretch lg:gap-2 xl:flex-row xl:items-start xl:gap-4',
              size === 'metric' && 'sm:flex-col sm:items-stretch sm:gap-2',
            )}
          >
            <span className="text-foreground min-w-0 font-medium text-balance break-words">
              {label}
            </span>
            <span
              className={cn(
                'flex shrink-0 items-center gap-3',
                size === 'overview' && 'lg:w-full lg:justify-between xl:w-auto',
                size === 'metric' && 'sm:w-full sm:justify-between',
              )}
            >
              <span className="flex flex-col items-end gap-0.5">
                <span className="text-muted text-xs">Average</span>
                <span className="numeric text-foreground text-right text-sm">{average}</span>
              </span>
            </span>
          </span>
          <span className={cn('block w-full', size === 'overview' && 'py-2')}>
            <PerformanceChart label={label} points={compact} prominent={size === 'overview'} />
          </span>
          {series.observationCount < 2 ? (
            <span className="text-muted w-full text-xs">
              {series.observationCount === 0
                ? 'No response history'
                : 'One response. Add another to see a trend.'}
            </span>
          ) : null}
        </button>
      </Card>

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
            aria-describedby={descriptionId}
            onKeyDown={trapFocus}
            className="border-border bg-surface shadow-float rounded-card max-w-column flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden border p-0"
          >
            <div className="border-border flex items-start justify-between gap-6 border-b p-4 sm:p-6">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 id={titleId} className="text-foreground text-lg font-semibold">
                  {label} response history
                </h2>
                <p id={descriptionId} className="text-muted text-sm">
                  Average <span className="numeric">{average}</span>. The chart runs from oldest to
                  latest. Responses are listed newest first.
                </p>
              </div>
              <Button ref={closeRef} variant="ghost" className="shrink-0" onClick={close}>
                Close
              </Button>
            </div>
            <div className="min-h-0 overflow-y-auto">
              <ExpandedHistory
                label={label}
                points={expanded}
                timezone={timezone}
                metric={metric}
              />
            </div>
          </Card>
        </ModalLayer>
      ) : null}
    </>
  )
}
