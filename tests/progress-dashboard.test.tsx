// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProgressDashboard } from '@/components/progress/progress-dashboard'
import { ProgressTrend } from '@/components/progress/progress-trend'
import { progressFilterHref } from '@/lib/progress/display'
import type { ProgressDashboardData } from '@/lib/progress/server'
import {
  PROGRESS_DIMENSION_IDS,
  type ProgressPoint,
  type ProgressSeries,
} from '@/lib/progress/v3-aggregation'
import {
  HOW_YOU_SOUNDED_METRICS,
  V3_METRIC_IDS,
  WHAT_YOU_SAID_METRICS,
  type V3MetricId,
} from '@/lib/scoring/v3/contracts'

const navigation = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}))

vi.mock('next/link', () => ({
  default: ({ href, ...props }: ComponentProps<'a'>) => <a href={String(href)} {...props} />,
}))

function point(
  attemptId: string,
  value: number,
  overrides: Partial<ProgressPoint> = {},
): ProgressPoint {
  return {
    attemptId,
    finishedAt: attemptId === 'attempt-1' ? '2026-09-05T06:30:00.000Z' : '2026-09-06T06:30:00.000Z',
    mode: 'interview',
    promptText:
      attemptId === 'attempt-1' ? 'Describe a difficult decision.' : 'Explain a project delay.',
    retryOfAttemptId: attemptId === 'attempt-1' ? null : 'attempt-1',
    value,
    valueOutOf: 100,
    earnedPoints: value,
    maxPoints: 100,
    raw: null,
    ...overrides,
  }
}

function series(points: readonly ProgressPoint[]): ProgressSeries {
  return {
    points,
    observationCount: points.length,
    latestValue: points.at(-1)?.value ?? null,
    averageValue:
      points.length === 0
        ? null
        : points.reduce((total, item) => total + item.value, 0) / points.length,
    state: points.length === 0 ? 'empty' : points.length === 1 ? 'insufficient_data' : 'ready',
  }
}

function metricSeries(metric: V3MetricId): ProgressSeries {
  const maximum = WHAT_YOU_SAID_METRICS.includes(metric as (typeof WHAT_YOU_SAID_METRICS)[number])
    ? 10
    : 15
  return series([
    point('attempt-1', 60, {
      earnedPoints: maximum * 0.6,
      maxPoints: maximum,
      raw: { component: 0.6, measurements: null },
    }),
    point('attempt-2', 80, {
      earnedPoints: maximum * 0.8,
      maxPoints: maximum,
      raw: { component: 0.8, measurements: null },
    }),
  ])
}

function dashboard(): ProgressDashboardData {
  const overall = series([point('attempt-1', 60), point('attempt-2', 80)])
  const section = series([
    point('attempt-1', 60, { earnedPoints: 30, maxPoints: 50 }),
    point('attempt-2', 80, { earnedPoints: 40, maxPoints: 50 }),
  ])
  const metrics = Object.fromEntries(
    V3_METRIC_IDS.map((metric) => [metric, metricSeries(metric)]),
  ) as Record<V3MetricId, ProgressSeries>

  return {
    timezone: 'America/Los_Angeles',
    progress: {
      filter: 'all',
      dimensionIds: PROGRESS_DIMENSION_IDS,
      counts: {
        input: 2,
        included: 2,
        complete: 2,
        partial: 0,
        malformed: 0,
        unsupportedVersion: 0,
        metadataMismatch: 0,
        invalidTimestamp: 0,
        excludedMode: 0,
      },
      overall,
      sections: { what_you_said: section, how_you_sounded: section },
      metrics,
    },
  }
}

afterEach(() => {
  navigation.push.mockReset()
})

describe('ProgressDashboard', () => {
  it('renders three overview trends and the exact six and four metric groups', () => {
    render(<ProgressDashboard dashboard={dashboard()} filter="all" />)

    const overview = screen.getByRole('region', { name: 'Performance overview' })
    const content = screen.getByRole('region', { name: 'What You Said' })
    const sound = screen.getByRole('region', { name: 'How You Sounded' })

    expect(within(overview).getAllByRole('button')).toHaveLength(3)
    expect(within(content).getAllByRole('button')).toHaveLength(WHAT_YOU_SAID_METRICS.length)
    expect(within(sound).getAllByRole('button')).toHaveLength(HOW_YOU_SOUNDED_METRICS.length)
    expect(screen.getAllByRole('img')).toHaveLength(13)
    expect(screen.queryByText(/track progress|stars|lessons/i)).not.toBeInTheDocument()
  })

  it('routes the mode filter without losing the progress route', () => {
    render(<ProgressDashboard dashboard={dashboard()} filter="all" />)

    expect(
      within(screen.getByLabelText('Show responses'))
        .getAllByRole('option')
        .map((option) => ({
          label: option.textContent,
          value: option.getAttribute('value'),
        })),
    ).toEqual([
      { label: 'All', value: 'all' },
      { label: 'General Speaking', value: 'practice' },
      { label: 'Interviews', value: 'interview' },
      { label: 'Presentations', value: 'presentation' },
      { label: 'Conversations', value: 'conversation' },
    ])

    fireEvent.change(screen.getByLabelText('Show responses'), {
      target: { value: 'interview' },
    })

    expect(navigation.push).toHaveBeenCalledWith(progressFilterHref('interview'))
  })

  it('expands a whole card into chronological, timezone-explicit result links', () => {
    render(<ProgressDashboard dashboard={dashboard()} filter="all" />)

    const card = screen.getByRole('button', {
      name: 'View Answered the Prompt response history',
    })
    expect(card).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(card)

    expect(card).toHaveAttribute('aria-expanded', 'true')
    const history = screen.getByRole('region', {
      name: 'Answered the Prompt response history',
    })
    const links = within(history).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/attempts/attempt-1',
      '/attempts/attempt-2',
    ])
    expect(within(history).getByText('Describe a difficult decision.')).toBeInTheDocument()
    expect(within(history).getByText('Interviews · Retry')).toBeInTheDocument()
    expect(within(history).getAllByText('Sep 4, 2026, 11:30 PM')).toHaveLength(1)
    expect(within(history).getAllByRole('time')[0]).toHaveAttribute(
      'datetime',
      '2026-09-05T06:30:00.000Z',
    )
  })

  it('uses the last ten observations in the chart and all observations when expanded', () => {
    const points = Array.from({ length: 12 }, (_, index) =>
      point(`history-${index + 1}`, index * 5, {
        finishedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      }),
    )
    const { container } = render(
      <ProgressTrend label="Overall" series={series(points)} timezone="UTC" />,
    )

    expect(container.querySelector('svg')).toHaveAttribute(
      'data-values',
      points
        .slice(-10)
        .map((item) => item.value)
        .join(','),
    )
    fireEvent.click(screen.getByRole('button', { name: 'View Overall response history' }))
    expect(screen.getAllByRole('link')).toHaveLength(12)
    expect(container.querySelector('[data-chart-size="expanded"]')).toHaveAttribute(
      'data-values',
      points.map((item) => item.value).join(','),
    )
  })

  it('renders deliberate empty and one-point states', () => {
    const { rerender } = render(
      <ProgressTrend label="Overall" series={series([])} timezone="UTC" />,
    )
    expect(screen.getByText('No checked results in this view.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Overall response history' })).toBeDisabled()

    rerender(
      <ProgressTrend label="Overall" series={series([point('attempt-1', 60)])} timezone="UTC" />,
    )
    expect(screen.getByText('One response. Add another to see a trend.')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('data-values', '60')
  })

  it('keeps earned points and normalized performance distinct and shows useful raw audio context', () => {
    const pace = series([
      point('attempt-1', 80, {
        earnedPoints: 6,
        maxPoints: 8,
        raw: { component: 0.8, measurements: { words_per_minute: 143.6 } },
      }),
    ])
    render(<ProgressTrend label="Pace" series={pace} timezone="UTC" metric="pace" />)

    expect(screen.getByText('6 / 8 · 80%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View Pace response history' }))
    expect(screen.getByText('144 WPM')).toBeInTheDocument()
  })
})
