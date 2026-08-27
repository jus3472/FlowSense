import Link from 'next/link'
import type { Metadata, Route } from 'next'
import { redirect } from 'next/navigation'
import { ProgressTrend } from '@/components/progress/progress-trend'
import { RetryButton } from '@/components/system/retry-button'
import { ErrorState } from '@/components/ui/error-state'
import { parseProgressMode, selectCategory } from '@/lib/progress/display'
import { retryDifferenceLabel } from '@/lib/progress/retries'
import {
  PRACTICE_MODES,
  SKILL_CATEGORIES,
  type PracticeMode,
  type SkillCategory,
} from '@/lib/practice/contracts'
import { getProgressDashboardData, type ProgressDashboardData } from '@/lib/progress/server'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Progress' }
export const dynamic = 'force-dynamic'
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

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>
}) {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser()
  if (!user) redirect('/login')
  const mode = parseProgressMode((await searchParams).mode)
  let dashboard: ProgressDashboardData | null = null
  try {
    dashboard = await getProgressDashboardData({ now: new Date(), mode })
  } catch {
    dashboard = null
  }
  if (!dashboard)
    return (
      <ErrorState
        title="Progress is unavailable"
        description="Your progress could not be loaded. Try again in a moment."
      >
        <RetryButton />
      </ErrorState>
    )
  const { progress, retryComparisons } = dashboard
  const window = progress.windows.all
  const strongest = selectCategory(window.categories, true)
  const needs = selectCategory(window.categories, false)
  return (
    <main className="flex flex-col gap-8 pb-12">
      <header>
        <p className="section-label text-muted">Progress</p>
        <h1 className="prompt-display text-foreground text-2xl">Your practice</h1>
      </header>
      <nav aria-label="Mode filters" className="flex flex-wrap gap-2">
        {['all', ...PRACTICE_MODES].map((value) => (
          <Link
            key={value}
            href={progressHref(value as 'all' | PracticeMode)}
            aria-current={(value === 'all' ? !mode : mode === value) ? 'page' : undefined}
            className={cn(
              'text-foreground flex min-h-11 items-center rounded-full px-4 text-sm font-medium',
              (value === 'all' ? !mode : mode === value)
                ? 'bg-accent-soft ring-accent ring-2 ring-inset'
                : 'bg-surface-sunken hover:bg-accent-soft',
            )}
          >
            {value === 'all' ? 'All' : labels[value as PracticeMode]}
          </Link>
        ))}
      </nav>
      <section className="bg-surface rounded-card p-6">
        <h2 className="text-foreground font-medium">Overall trend</h2>
        <div className="mt-3">
          <ProgressTrend label="Overall" series={window.overall} />
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        {SKILL_CATEGORIES.map((category) => (
          <div key={category} className="bg-surface rounded-card p-4">
            <p className="text-muted text-sm">{labels[category]}</p>
            <ProgressTrend label={labels[category]} series={window.categories[category]} />
          </div>
        ))}
      </section>
      <section className="text-muted flex flex-col gap-2 text-sm">
        {strongest ? (
          <p>Current strongest category: {labels[strongest]}</p>
        ) : (
          <p>Complete two scored responses to identify a strongest category.</p>
        )}
        {needs ? <p>Category needing the most practice: {labels[needs]}</p> : null}
        <p>Recent practice: {progress.windows.recent.attemptCount} responses in 7 days.</p>
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
                href={`/attempts/${retry.attemptId}`}
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
    </main>
  )
}
