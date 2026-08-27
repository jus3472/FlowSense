import type { Route } from 'next'
import Link from 'next/link'
import { ProgressTrend } from '@/components/progress/progress-trend'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
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
}: {
  dashboard: ProgressDashboardData
  mode?: PracticeMode
}) {
  const { progress, retryComparisons } = dashboard
  const window = progress.windows.all
  const strongest = selectCategory(window.categories, true)
  const needs = selectCategory(window.categories, false)
  const hasLimitedSeries =
    window.overall.state === 'insufficient_data' ||
    SKILL_CATEGORIES.some((category) => window.categories[category].state === 'insufficient_data')
  const hasExcludedSnapshots =
    progress.counts.malformed > 0 ||
    progress.counts.unsupportedVersion > 0 ||
    progress.counts.excludedIncompatible > 0

  return (
    <div className="flex flex-col gap-8 pb-12">
      <header>
        <p className="section-label text-muted">Progress</p>
        <h1 className="prompt-display text-foreground text-2xl">Your practice</h1>
      </header>

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

      {progress.counts.selectedCohort === 0 ? (
        <EmptyProgress mode={mode} hasAttempts={progress.counts.input > 0} />
      ) : (
        <>
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

          <section aria-label="Progress summary" className="text-muted flex flex-col gap-2 text-sm">
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
            <p>Recent practice: {responseCount(progress.windows.recent.attemptCount)} in 7 days.</p>
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
        </>
      )}

      {hasExcludedSnapshots ? (
        <p className="text-muted text-xs">
          Some saved results use a different or unavailable result format and are not included.
        </p>
      ) : null}

      {dashboard.coverage.truncated ? (
        <p className="text-muted text-xs">
          This view uses your {dashboard.coverage.completedAttemptLimit} most recent completed
          responses. Earlier responses are not included.
        </p>
      ) : null}
    </div>
  )
}
