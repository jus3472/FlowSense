// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProgressDashboard } from '@/components/progress/progress-dashboard'
import { ProgressTrend } from '@/components/progress/progress-trend'
import { aggregateV2Progress, type ProgressSeries } from '@/lib/progress/aggregation'
import { parseProgressMode, selectCategory } from '@/lib/progress/display'
import {
  recentRetryComparisons,
  retryDifferenceLabel,
  type ProgressRetryAttemptInput,
} from '@/lib/progress/retries'
import { SKILL_CATEGORIES, type PracticeMode, type SkillCategory } from '@/lib/practice/contracts'
import {
  V2_SCORE_PAYLOAD_VERSION,
  type V2PersistedCategoryScore,
  type V2ScorePayload,
} from '@/lib/scoring/v2/assemble'
import { rubricFor } from '@/lib/scoring/v2/rubrics'
import { legacySectionSnapshot, progressAttempt, v2Snapshot } from './helpers/result-snapshots'

vi.mock('next/link', () => ({
  default: ({ href, ...props }: ComponentProps<'a'>) => <a href={String(href)} {...props} />,
}))

const NOW = new Date('2026-08-26T12:00:00.000Z')

function series(values: readonly number[]): ProgressSeries {
  return {
    points: values.map((value, index) => ({
      attemptId: `attempt-${index}`,
      createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
      value,
      valueOutOf: 100,
    })),
    valueCount: values.length,
    state: values.length >= 2 ? 'ready' : 'insufficient_data',
    averageValue:
      values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
  }
}

function payload(mode: PracticeMode, component: number): V2ScorePayload {
  const rubric = rubricFor(mode)
  const categories = Object.fromEntries(
    SKILL_CATEGORIES.map((category) => {
      const maxPoints = rubric.categories[category].weight
      const result: V2PersistedCategoryScore = {
        category,
        availability: 'available',
        status: 'scored',
        component,
        earned_points: Math.round(component * maxPoints),
        max_points: maxPoints,
        measurements: {},
        evidence: [],
        deductions: [],
        warnings: [],
      }
      return [category, result]
    }),
  ) as Record<SkillCategory, V2PersistedCategoryScore>
  return {
    version: V2_SCORE_PAYLOAD_VERSION,
    rubric_version: 'v2',
    mode,
    total_earned_points: Object.values(categories).reduce(
      (sum, category) => sum + (category.earned_points ?? 0),
      0,
    ),
    total_max_points: 100,
    categories,
    warnings: [],
  }
}

function attempt(
  id: string,
  createdAt: string,
  score: V2ScorePayload,
  retryOfAttemptId: string | null = null,
): ProgressRetryAttemptInput {
  return { id, createdAt, retryOfAttemptId, sectionScores: score }
}

describe('progress dashboard helpers', () => {
  it('parses only one supported mode value', () => {
    expect(parseProgressMode('interview')).toBe('interview')
    expect(parseProgressMode('unknown')).toBeUndefined()
    expect(parseProgressMode(['interview', 'practice'])).toBeUndefined()
  })

  it('selects only a unique ready strongest or practice category', () => {
    const categories = Object.fromEntries(
      SKILL_CATEGORIES.map((category) => [category, series([50, 50])]),
    ) as Record<SkillCategory, ProgressSeries>
    categories.fluency = series([80, 90])
    categories.grammar = series([30, 40])

    expect(selectCategory(categories, true)).toBe('fluency')
    expect(selectCategory(categories, false)).toBe('grammar')

    categories.fluency = series([50, 50])
    categories.grammar = series([50, 50])
    expect(selectCategory(categories, true)).toBeNull()
  })

  it('shows a current value, an accessible trend, and an explicit insufficient state', () => {
    const { rerender } = render(<ProgressTrend label="Fluency" series={series([72, 84])} />)

    expect(screen.getByText('84 / 100')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Fluency trend from oldest to latest: 72 to 84' }),
    ).toHaveAttribute('data-values', '72,84')

    rerender(<ProgressTrend label="Fluency" series={series([72])} />)
    expect(screen.getByText('72 / 100')).toBeInTheDocument()
    expect(
      screen.getByText('Complete two compatible responses to see a trend.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps recent compatible retry differences and drops incompatible or old retries', () => {
    const parent = attempt('parent', '2026-08-01T12:00:00.000Z', payload('practice', 0.8))
    const recent = attempt(
      'recent',
      '2026-08-25T12:00:00.000Z',
      payload('practice', 0.81),
      'parent',
    )
    const incompatible = attempt(
      'incompatible',
      '2026-08-24T12:00:00.000Z',
      payload('interview', 0.9),
      'parent',
    )
    const old = attempt('old', '2026-08-01T12:00:00.000Z', payload('practice', 0.9), 'parent')

    const result = recentRetryComparisons([parent, recent, incompatible, old], { now: NOW })

    expect(result.map((comparison) => comparison.attemptId)).toEqual(['recent'])
    const overall = result[0]?.comparison.rows.find((row) => row.category === 'overall')
    expect(overall).toBeDefined()
    expect(overall && retryDifferenceLabel(overall)).toBe('Small score difference')
  })

  it('applies mode filters and uses neutral direction labels beyond the noise threshold', () => {
    const parent = attempt('parent', '2026-08-20T12:00:00.000Z', payload('practice', 0.5))
    const retry = attempt('retry', '2026-08-25T12:00:00.000Z', payload('practice', 0.8), 'parent')
    expect(recentRetryComparisons([parent, retry], { now: NOW, mode: 'interview' })).toEqual([])

    const overall = recentRetryComparisons([parent, retry], { now: NOW })[0]?.comparison.rows.find(
      (row) => row.category === 'overall',
    )
    expect(overall && retryDifferenceLabel(overall)).toMatch(/^Up /)
    expect(overall && retryDifferenceLabel(overall)).not.toContain('improv')
  })

  it('keeps Progress discoverable from the compact account menu', () => {
    const menu = readFileSync('src/components/layout/overflow-menu.tsx', 'utf8')
    expect(menu).toContain("'/progress' as Route")
    expect(menu).toMatch(/role="menuitem"[\s\S]*?>\s*Progress\s*<\/Link>/)
  })

  it('renders zero-attempt and legacy-only accounts as valid empty states', () => {
    const empty = aggregateV2Progress([], { now: NOW })
    const { rerender } = render(
      <ProgressDashboard dashboard={{ progress: empty, retryComparisons: [] }} />,
    )

    expect(screen.getByText('No practice results yet')).toBeInTheDocument()
    expect(screen.queryByText('Progress is unavailable')).not.toBeInTheDocument()

    const legacyOnly = aggregateV2Progress(
      [progressAttempt('legacy', '2026-08-25T12:00:00.000Z', legacySectionSnapshot)],
      { now: NOW },
    )
    rerender(<ProgressDashboard dashboard={{ progress: legacyOnly, retryComparisons: [] }} />)

    expect(screen.getByText('No compatible progress yet')).toBeInTheDocument()
    expect(screen.queryByText('Progress is unavailable')).not.toBeInTheDocument()
  })

  it('renders a truthful limited state and all category trends for one partial result', () => {
    const progress = aggregateV2Progress(
      [
        progressAttempt(
          'partial',
          '2026-08-25T12:00:00.000Z',
          v2Snapshot({ notCheckedCategory: 'grammar' }),
        ),
      ],
      { now: NOW },
    )
    render(<ProgressDashboard dashboard={{ progress, retryComparisons: [] }} />)

    expect(screen.getByText('Some trends need more data')).toBeInTheDocument()
    expect(
      screen.getByText('Each trend appears after two compatible checked results.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Category trends' })).toBeInTheDocument()
    for (const label of ['Fluency', 'Clarity', 'Vocabulary', 'Grammar', 'Structure', 'Delivery']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText('Recent practice: 1 response in 7 days.')).toBeInTheDocument()
  })

  it('renders compatible retry arrows with neutral noise wording', () => {
    const parent = progressAttempt(
      'parent',
      '2026-08-20T12:00:00.000Z',
      v2Snapshot({ component: 0.8 }),
    )
    const retry = progressAttempt(
      'retry',
      '2026-08-25T12:00:00.000Z',
      v2Snapshot({ component: 0.81 }),
      'parent',
    )
    const attempts = [parent, retry]
    const progress = aggregateV2Progress(attempts, { now: NOW })
    const retryComparisons = recentRetryComparisons(attempts, { now: NOW })
    render(<ProgressDashboard dashboard={{ progress, retryComparisons }} />)

    expect(screen.getByRole('heading', { name: 'Recent retries' })).toBeInTheDocument()
    expect(screen.getAllByText(/→/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Small score difference').length).toBeGreaterThan(0)
    expect(screen.queryByText(/improved|worse/i)).not.toBeInTheDocument()
  })

  it('does not add a second main landmark inside the app layout main', () => {
    const progress = aggregateV2Progress([], { now: NOW })
    const { container } = render(
      <ProgressDashboard dashboard={{ progress, retryComparisons: [] }} />,
    )
    const pageSource = readFileSync('src/app/(app)/progress/page.tsx', 'utf8')
    const dashboardSource = readFileSync('src/components/progress/progress-dashboard.tsx', 'utf8')

    expect(container.querySelector('main')).toBeNull()
    expect(pageSource).not.toMatch(/<main\b/)
    expect(dashboardSource).not.toMatch(/<main\b/)
  })
})
