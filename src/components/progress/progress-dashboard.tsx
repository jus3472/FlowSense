import type { Route } from 'next'
import Link from 'next/link'
import { CurriculumProgress } from '@/components/progress/curriculum-progress'
import { ProgressTrend } from '@/components/progress/progress-trend'
import { RetryButton } from '@/components/system/retry-button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import type { CurriculumOverviewData } from '@/lib/curriculum/overview'
import { selectCategory } from '@/lib/progress/display'
import { retryDifferenceLabel } from '@/lib/progress/retries'
import type { ProgressDashboardData } from '@/lib/progress/server'
import {
  PRACTICE_MODES,
  SKILL_CATEGORIES,
  type PracticeMode,
  type SkillCategory,
} from '@/lib/practice/contracts'
import { cn } from '@/lib/utils'

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
  const retryComparisons = dashboard?.retryComparisons ?? []
  const window = progress?.windows.all ?? null
  const strongest = window ? selectCategory(window.categories, true) : null
  const needs = window ? selectCategory(window.categories, false) : null
  const hasLimitedSeries =
    window !== null &&
    (window.overall.state === 'insufficient_data' ||
      SKILL_CATEGORIES.some(
        (category) => window.categories[category].state === 'insufficient_data',
      ))
  const hasExcludedSnapshots =
    progress !== null &&
    (progress.counts.malformed > 0 ||
      progress.counts.unsupportedVersion > 0 ||
      progress.counts.excludedIncompatible > 0)

  return (
    <div className="flex flex-col gap-8 pb-12">
      <header>
        <p className="section-label text-muted">Progress</p>
        <h1 className="prompt-display text-foreground text-2xl">Your progress</h1>
      </header>

      {curriculum ? <CurriculumProgress overview={curriculum} /> : null}
      {curriculumUnavailable ? (
        <section aria-labelledby="curriculum-progress-heading" className="flex flex-col gap-3">
          <h2 id="curriculum-progress-heading" className="text-foreground text-xl font-semibold">
            Path progress
          </h2>
          <Card className="flex flex-col gap-3">
            <div>
              <h3 className="text-foreground font-medium">Path progress is unavailable</h3>
              <p className="text-muted mt-1 text-sm">Your lesson progress could not be loaded.</p>
            </div>
            <RetryButton />
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="speaking-progress-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 id="speaking-progress-heading" className="text-foreground text-xl font-semibold">
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
                  'text-foreground flex min-h-11 items-center rounded-full px-4 text-sm font-medium',
                  selected
                    ? 'bg-accent-soft ring-accent ring-2 ring-inset'
                    : 'bg-surface-sunken hover:bg-accent-soft',
                )}
              >
                {value === 'all' ? 'All' : labels[value]}
              </Link>
            )
          })}
        </nav>

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
        ) : progress && window && progress.counts.selectedCohort === 0 ? (
          <EmptyProgress mode={mode} hasAttempts={progress.counts.input > 0} />
        ) : progress && window ? (
          <div className="flex flex-col gap-6">
            {hasLimitedSeries ? (
              <Card className="flex flex-col gap-1">
                <h2 className="text-foreground font-medium">Some trends need more data</h2>
                <p className="text-muted text-sm">
                  Each trend appears after two compatible checked results.
                </p>
              </Card>
            ) : null}

            <section className="bg-surface rounded-card p-6">
              <h2 className="text-foreground font-medium">Overall trend</h2>
              <div className="mt-3">
                <ProgressTrend label="Overall" series={window.overall} />
              </div>
            </section>

            <section aria-label="Category trends" className="grid gap-3 sm:grid-cols-2">
              {SKILL_CATEGORIES.map((category) => (
                <div key={category} className="bg-surface rounded-card p-4">
                  <h2 className="text-muted text-sm">{labels[category]}</h2>
                  <ProgressTrend label={labels[category]} series={window.categories[category]} />
                </div>
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
                  <p className="text-muted mt-1 text-sm">Compatible scores from the same prompt.</p>
                </div>
                <div className="flex flex-col gap-3">
                  {retryComparisons.map((retry) => (
                    <Link
                      key={retry.attemptId}
                      href={attemptHref(retry.attemptId)}
                      className="bg-surface rounded-card hover:bg-surface-sunken flex flex-col gap-2 p-4"
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
    </div>
  )
}
