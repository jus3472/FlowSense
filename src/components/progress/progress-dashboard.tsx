import type { Route } from 'next'
import Link from 'next/link'
import { CurriculumProgress } from '@/components/progress/curriculum-progress'
import { ProgressTrend } from '@/components/progress/progress-trend'
import { RetryButton } from '@/components/system/retry-button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'
import type { CurriculumOverviewData } from '@/lib/curriculum/overview'
import { selectCategory, selectProgressDimension } from '@/lib/progress/display'
import { retryDifferenceLabel } from '@/lib/progress/retries'
import type { ProgressDashboardData } from '@/lib/progress/server'
import {
  PRACTICE_MODES,
  SKILL_CATEGORIES,
  type PracticeMode,
  type SkillCategory,
} from '@/lib/practice/contracts'
import { cn } from '@/lib/utils'
import { V3_METRIC_LABELS } from '@/lib/scoring/v3/contracts'

const labels: Record<PracticeMode | SkillCategory, string> = {
  practice: 'Practice',
  interview: 'Interviews',
  presentation: 'Presentations',
  conversation: 'Conversations',
  fluency: 'Fluency',
  clarity: 'Clarity',
  vocabulary: 'Vocabulary',
  grammar: 'Grammar',
  structure: 'Structure',
  delivery: 'Delivery',
}

function progressHref(value: 'all' | PracticeMode): Route {
  return (value === 'all' ? '/progress' : `/progress?mode=${value}`) as Route
}

function attemptHref(attemptId: string): Route {
  return `/attempts/${attemptId}` as Route
}

function responseCount(count: number): string {
  return `${count} ${count === 1 ? 'response' : 'responses'}`
}

function EmptyProgress({ mode, hasAttempts }: { mode?: PracticeMode; hasAttempts: boolean }) {
  const title = mode
    ? 'No compatible progress for this mode'
    : hasAttempts
      ? 'No compatible progress yet'
      : 'No practice results yet'
  const description = mode
    ? 'Complete a response in this mode to start its progress view.'
    : hasAttempts
      ? 'Complete a response with the current score format to start this progress view.'
      : 'Complete a response to start your progress view.'

  return (
    <Card>
      <EmptyState title={title} description={description} />
    </Card>
  )
}

export function ProgressDashboard({
  dashboard,
  mode,
  curriculum,
  curriculumUnavailable = false,
}: {
  dashboard: ProgressDashboardData | null
  mode?: PracticeMode
  curriculum?: CurriculumOverviewData | null
  curriculumUnavailable?: boolean
}) {
  const progress = dashboard?.progress ?? null
  const v3Progress = dashboard?.v3Progress ?? null
  const retryComparisons = dashboard?.retryComparisons ?? []
  const v3RetryComparisons = dashboard?.v3RetryComparisons ?? []
  const window = progress?.windows.all ?? null
  const v3Window = v3Progress?.windows.all ?? null
  const v3MetricIds = v3Progress?.metricIds ?? []
  const hasV3 = (v3Progress?.counts.selectedCohort ?? 0) > 0
  const hasV2 = (progress?.counts.selectedCohort ?? 0) > 0
  const strongest = window ? selectCategory(window.categories, true) : null
  const needs = window ? selectCategory(window.categories, false) : null
  const strongestV3 = v3Window ? selectProgressDimension(v3MetricIds, v3Window.metrics, true) : null
  const needsV3 = v3Window ? selectProgressDimension(v3MetricIds, v3Window.metrics, false) : null
  const hasLimitedSeries =
    window !== null &&
    (window.overall.state === 'insufficient_data' ||
      SKILL_CATEGORIES.some(
        (category) => window.categories[category].state === 'insufficient_data',
      ))
  const hasExcludedSnapshots =
    (progress !== null &&
      (progress.counts.malformed > 0 || progress.counts.unsupportedVersion > 0)) ||
    (v3Progress !== null &&
      (v3Progress.counts.malformed > 0 || v3Progress.counts.unsupportedVersion > 0))
  const hasLimitedV3Series =
    v3Window !== null &&
    (v3Window.overall.state === 'insufficient_data' ||
      v3MetricIds.some((metric) => v3Window.metrics[metric].state === 'insufficient_data'))

  return (
    <PageShell>
      <PageTitle>Progress</PageTitle>

      {curriculum ? <CurriculumProgress overview={curriculum} /> : null}
      {curriculumUnavailable ? (
        <section aria-label="Track progress">
          <Card className="flex flex-col gap-3">
            <div>
              <h2 className="text-foreground font-medium">Track progress is unavailable</h2>
              <p className="text-muted mt-1 text-sm">Your lesson progress could not be loaded.</p>
            </div>
            <RetryButton />
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="speaking-progress-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 id="speaking-progress-heading" className="prompt-display text-foreground text-xl">
            Speaking skill progress
          </h2>
          <p className="text-muted text-sm">These trends use compatible scored responses.</p>
        </div>

        <nav aria-label="Mode filters" className="flex flex-wrap gap-2">
          {(['all', ...PRACTICE_MODES] as const).map((value) => {
            const selected = value === 'all' ? !mode : mode === value
            return (
              <Link
                key={value}
                href={progressHref(value)}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  'border-border text-foreground rounded-input flex min-h-11 items-center border px-4 text-sm font-medium',
                  selected
                    ? 'border-accent bg-accent-soft ring-accent ring-1'
                    : 'bg-surface hover:bg-surface-sunken',
                )}
              >
                {value === 'all' ? 'All' : labels[value]}
              </Link>
            )
          })}
        </nav>

        {hasV3 && v3Progress && v3Window ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <h3 className="text-foreground font-medium">Current metric trends</h3>
              <p className="text-muted text-sm">
                These use the current What You Said and How You Sounded metrics.
              </p>
            </div>

            {hasLimitedV3Series ? (
              <Card className="flex flex-col gap-1">
                <h3 className="text-foreground font-medium">Some trends need more data</h3>
                <p className="text-muted text-sm">
                  Each trend appears after two compatible checked results.
                </p>
              </Card>
            ) : null}

            <Card>
              <h3 className="text-foreground font-medium">Overall trend</h3>
              <div className="mt-3">
                <ProgressTrend label="Overall" series={v3Window.overall} />
              </div>
            </Card>

            <section
              aria-label="Current metric trends"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {v3MetricIds.map((metric) => (
                <Card key={metric} className="p-4">
                  <h3 className="text-muted text-sm">{V3_METRIC_LABELS[metric]}</h3>
                  <ProgressTrend
                    label={V3_METRIC_LABELS[metric]}
                    series={v3Window.metrics[metric]}
                  />
                </Card>
              ))}
            </section>

            <section
              aria-label="Current progress summary"
              className="text-muted flex flex-col gap-2 text-sm"
            >
              <p>
                {strongestV3
                  ? `Current strongest metric: ${V3_METRIC_LABELS[strongestV3]}`
                  : 'More checked results are needed to identify a strongest metric.'}
              </p>
              <p>
                {needsV3
                  ? `Metric needing the most practice: ${V3_METRIC_LABELS[needsV3]}`
                  : 'More checked results are needed to identify a practice metric.'}
              </p>
              <p>
                Recent practice: {responseCount(v3Progress.windows.recent.attemptCount)} in 7 days.
              </p>
            </section>

            {v3RetryComparisons.length > 0 ? (
              <section aria-labelledby="v3-retry-progress-heading" className="flex flex-col gap-3">
                <div>
                  <h3 id="v3-retry-progress-heading" className="text-foreground font-medium">
                    Recent retries
                  </h3>
                  <p className="text-muted mt-1 text-sm">Current metrics from the same prompt.</p>
                </div>
                <div className="flex flex-col gap-3">
                  {v3RetryComparisons.map((retry) => (
                    <Link
                      key={retry.attemptId}
                      href={attemptHref(retry.attemptId)}
                      className="border-border bg-surface shadow-card rounded-card hover:bg-surface-sunken flex flex-col gap-2 border p-4"
                    >
                      {retry.comparison.rows.slice(0, 3).map((row) => (
                        <div key={row.category} className="flex items-center justify-between gap-4">
                          <span className="text-foreground text-sm">{row.label}</span>
                          <span className="text-muted flex items-center gap-3 text-xs">
                            <span className="numeric text-foreground">
                              {row.previousPoints} → {row.currentPoints}
                            </span>
                            <span>{retryDifferenceLabel(row)}</span>
                          </span>
                        </div>
                      ))}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {dashboard === null ? (
          <Card className="flex flex-col gap-3">
            <div>
              <h3 className="text-foreground font-medium">
                Speaking skill progress is unavailable
              </h3>
              <p className="text-muted mt-1 text-sm">Your response trends could not be loaded.</p>
            </div>
            <RetryButton />
          </Card>
        ) : progress && window && progress.counts.selectedCohort === 0 && !hasV3 ? (
          <EmptyProgress mode={mode} hasAttempts={progress.counts.input > 0} />
        ) : progress && window && hasV2 ? (
          <details open={!hasV3} className="flex flex-col gap-6">
            <summary className="text-foreground cursor-pointer font-medium">
              {hasV3 ? 'Earlier category trends' : 'Category trends'}
            </summary>
            <div className="mt-6 flex flex-col gap-6">
              {hasLimitedSeries ? (
                <Card className="flex flex-col gap-1">
                  <h2 className="text-foreground font-medium">Some trends need more data</h2>
                  <p className="text-muted text-sm">
                    Each trend appears after two compatible checked results.
                  </p>
                </Card>
              ) : null}

              <Card>
                <h2 className="text-foreground font-medium">Overall trend</h2>
                <div className="mt-3">
                  <ProgressTrend label="Overall" series={window.overall} />
                </div>
              </Card>

              <section
                aria-label="Category trends"
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {SKILL_CATEGORIES.map((category) => (
                  <Card key={category} className="p-4">
                    <h2 className="text-muted text-sm">{labels[category]}</h2>
                    <ProgressTrend label={labels[category]} series={window.categories[category]} />
                  </Card>
                ))}
              </section>

              <section
                aria-label="Progress summary"
                className="text-muted flex flex-col gap-2 text-sm"
              >
                {strongest ? (
                  <p>Current strongest category: {labels[strongest]}</p>
                ) : (
                  <p>More checked results are needed to identify a strongest category.</p>
                )}
                {needs ? (
                  <p>Category needing the most practice: {labels[needs]}</p>
                ) : (
                  <p>More checked results are needed to identify a practice category.</p>
                )}
                <p>
                  Recent practice: {responseCount(progress.windows.recent.attemptCount)} in 7 days.
                </p>
              </section>

              {retryComparisons.length > 0 ? (
                <section aria-labelledby="retry-progress-heading" className="flex flex-col gap-3">
                  <div>
                    <h2 id="retry-progress-heading" className="text-foreground font-medium">
                      Recent retries
                    </h2>
                    <p className="text-muted mt-1 text-sm">
                      Compatible scores from the same prompt.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    {retryComparisons.map((retry) => (
                      <Link
                        key={retry.attemptId}
                        href={attemptHref(retry.attemptId)}
                        className="border-border bg-surface shadow-card rounded-card hover:bg-surface-sunken flex flex-col gap-2 border p-4"
                      >
                        {retry.comparison.rows.slice(0, 3).map((row) => (
                          <div
                            key={row.category}
                            className="flex items-center justify-between gap-4"
                          >
                            <span className="text-foreground text-sm">{row.label}</span>
                            <span className="text-muted flex items-center gap-3 text-xs">
                              <span className="numeric text-foreground">
                                {row.previousPoints} → {row.currentPoints}
                              </span>
                              <span>{retryDifferenceLabel(row)}</span>
                            </span>
                          </div>
                        ))}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </details>
        ) : null}

        {hasExcludedSnapshots ? (
          <p className="text-muted text-xs">
            Some saved results use a different or unavailable result format and are not included.
          </p>
        ) : null}

        {dashboard?.coverage.truncated ? (
          <p className="text-muted text-xs">
            This view uses your {dashboard.coverage.completedAttemptLimit} most recent completed
            responses. Earlier responses are not included.
          </p>
        ) : null}
      </section>
    </PageShell>
  )
}
