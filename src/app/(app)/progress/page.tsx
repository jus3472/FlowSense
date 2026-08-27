import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ProgressTrend } from '@/components/progress/progress-trend'
import { ErrorState } from '@/components/ui/error-state'
import { RetryButton } from '@/components/system/retry-button'
import type { ProgressAggregation } from '@/lib/progress/aggregation'
import { selectCategory } from '@/lib/progress/display'
import {
  PRACTICE_MODES,
  SKILL_CATEGORIES,
  type PracticeMode,
  type SkillCategory,
} from '@/lib/practice/contracts'
import { getV2Progress } from '@/lib/progress/server'
import { createClient } from '@/lib/supabase/server'

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

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>
}) {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser()
  if (!user) redirect('/login')
  const rawMode = (await searchParams).mode
  const mode = PRACTICE_MODES.includes(rawMode as PracticeMode)
    ? (rawMode as PracticeMode)
    : undefined
  let progress: ProgressAggregation | null = null
  try {
    progress = await getV2Progress({ now: new Date(), mode })
  } catch {
    progress = null
  }
  if (!progress)
    return (
      <ErrorState
        title="Progress is unavailable"
        description="Your progress could not be loaded. Try again in a moment."
      >
        <RetryButton />
      </ErrorState>
    )
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
            href={value === 'all' ? '/progress' : `/progress?mode=${value}`}
            aria-current={(value === 'all' ? !mode : mode === value) ? 'page' : undefined}
            className="bg-surface-sunken rounded-full px-4 py-2 text-sm"
          >
            {value === 'all' ? 'All' : labels[value as PracticeMode]}
          </Link>
        ))}
      </nav>
      <section className="bg-surface rounded-card p-6">
        <h2 className="text-foreground font-medium">Overall trend</h2>
        {window.overall.state === 'ready' ? (
          <ProgressTrend label="Overall" series={window.overall} />
        ) : (
          <p className="text-muted mt-3 text-sm">
            Complete two compatible responses to see a trend.
          </p>
        )}
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
    </main>
  )
}
