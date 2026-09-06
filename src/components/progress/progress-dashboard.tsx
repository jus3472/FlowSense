import { ProgressFilterSelect } from '@/components/progress/progress-filter'
import { ProgressTrend } from '@/components/progress/progress-trend'
import { RetryButton } from '@/components/system/retry-button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'
import type { ProgressDashboardData } from '@/lib/progress/server'
import type { ProgressFilter } from '@/lib/progress/v3-aggregation'
import {
  HOW_YOU_SOUNDED_METRICS,
  V3_METRIC_LABELS,
  WHAT_YOU_SAID_METRICS,
} from '@/lib/scoring/v3/contracts'
import { UTC_TIMEZONE } from '@/lib/timezone'

function EmptyProgress({ filter }: { filter: ProgressFilter }) {
  return (
    <Card>
      <EmptyState
        title={filter === 'all' ? 'No performance history yet' : 'No performance history here yet'}
        description="Complete a response to start seeing your progress."
      />
    </Card>
  )
}

export function ProgressDashboard({
  dashboard,
  filter,
}: {
  dashboard: ProgressDashboardData | null
  filter: ProgressFilter
}) {
  const selectedFilter = dashboard?.progress.filter ?? filter
  const progress = dashboard?.progress ?? null
  const timezone = dashboard?.timezone ?? UTC_TIMEZONE
  const hasProgress =
    progress !== null &&
    [
      progress.overall,
      ...Object.values(progress.sections),
      ...Object.values(progress.metrics),
    ].some((series) => series.observationCount > 0)
  const hasExcludedSnapshots =
    progress !== null &&
    (progress.counts.malformed > 0 ||
      progress.counts.unsupportedVersion > 0 ||
      progress.counts.metadataMismatch > 0 ||
      progress.counts.invalidTimestamp > 0)

  return (
    <PageShell className="gap-8">
      <header className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <PageTitle>Progress</PageTitle>
          <p className="text-muted max-w-reading text-sm">
            See how your speaking performance changes across responses.
          </p>
        </div>
        <ProgressFilterSelect filter={selectedFilter} />
      </header>

      {hasProgress && progress ? (
        <div className="flex min-w-0 flex-col gap-12">
          <section aria-labelledby="performance-overview-heading" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2
                id="performance-overview-heading"
                className="prompt-display text-foreground text-xl"
              >
                Performance overview
              </h2>
              <p className="text-muted text-sm">Select a card to see every checked response.</p>
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-3">
              <ProgressTrend
                label="Overall Score"
                series={progress.overall}
                timezone={timezone}
                size="overview"
              />
              <ProgressTrend
                label="What You Said"
                series={progress.sections.what_you_said}
                timezone={timezone}
                size="overview"
              />
              <ProgressTrend
                label="How You Sounded"
                series={progress.sections.how_you_sounded}
                timezone={timezone}
                size="overview"
              />
            </div>
          </section>

          <section aria-labelledby="content-metrics-heading" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="content-metrics-heading" className="prompt-display text-foreground text-xl">
                What You Said
              </h2>
              <p className="text-muted text-sm">Six measures of the response you gave.</p>
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {WHAT_YOU_SAID_METRICS.map((metric) => (
                <ProgressTrend
                  key={metric}
                  label={V3_METRIC_LABELS[metric]}
                  series={progress.metrics[metric]}
                  timezone={timezone}
                  metric={metric}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="audio-metrics-heading" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="audio-metrics-heading" className="prompt-display text-foreground text-xl">
                How You Sounded
              </h2>
              <p className="text-muted text-sm">Four measures of how this response sounded.</p>
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {HOW_YOU_SOUNDED_METRICS.map((metric) => (
                <ProgressTrend
                  key={metric}
                  label={V3_METRIC_LABELS[metric]}
                  series={progress.metrics[metric]}
                  timezone={timezone}
                  metric={metric}
                />
              ))}
            </div>
          </section>
        </div>
      ) : dashboard === null ? (
        <Card className="flex flex-col gap-3">
          <div>
            <h2 className="text-foreground font-medium">Performance progress is unavailable</h2>
            <p className="text-muted mt-1 text-sm">Your response trends could not be loaded.</p>
          </div>
          <RetryButton />
        </Card>
      ) : (
        <EmptyProgress filter={selectedFilter} />
      )}

      {hasExcludedSnapshots ? (
        <p className="text-muted text-xs">
          Some saved results use a different or unavailable result format and are not included.
        </p>
      ) : null}
    </PageShell>
  )
}
