import type { PracticeMode } from '@/lib/practice/contracts'
import type { HistoryScoreSummary } from '@/lib/results/history-cohort'

const MODE_LABEL: Record<PracticeMode, string> = {
  practice: 'General Practice',
  interview: 'Interview',
  presentation: 'Presentation',
  conversation: 'Conversation',
}

function cohortDescription(summary: HistoryScoreSummary): string {
  if (!summary.cohort || summary.points.length === 0) {
    return 'No compatible scored responses are available in this filter.'
  }
  const label = summary.cohort.kind === 'legacy' ? 'legacy' : MODE_LABEL[summary.cohort.mode]
  return `${summary.points.length} compatible ${label} ${summary.points.length === 1 ? 'response' : 'responses'}.`
}

function coverageDescription(summary: HistoryScoreSummary): string {
  const base = summary.truncated
    ? `Statistics use the latest ${summary.scanLimit} completed responses in this filter.`
    : 'Statistics use completed responses in this filter.'
  if (summary.excludedCount === 0) return base
  return `${base} ${summary.excludedCount} ${summary.excludedCount === 1 ? 'response uses another mode or result generation, or has' : 'responses use another mode or result generation, or have'} no comparable overall.`
}

/** A bounded trend for one exact stored-result cohort, never the visible page's mixed scores. */
export function TrendChart({ summary }: { summary: HistoryScoreSummary }) {
  const scores = summary.points.map((point) => point.value)
  const average = summary.average
  const hasTrend = scores.length >= 2 && average !== null
  const width = 320
  const height = 72
  const step = hasTrend ? width / (scores.length - 1) : 0
  const y = (score: number) => height - (score / 100) * height
  const points = scores.map((score, index) => `${index * step},${y(score)}`).join(' ')
  const bandHeight = 8
  const bandTop = average === null ? 0 : Math.max(0, Math.min(height - bandHeight, y(average) - 4))

  return (
    <div className="bg-surface rounded-card flex flex-col gap-3 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-muted text-sm font-medium">Compatible score trend</h2>
        {average !== null ? (
          <p className="numeric text-muted text-xs">cohort average {Math.round(average)}</p>
        ) : null}
      </div>
      <p className="text-foreground text-sm">{cohortDescription(summary)}</p>
      {hasTrend ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Compatible scores, averaging ${Math.round(average)} out of 100`}
          className="h-[72px] w-full"
        >
          <rect x="0" y={bandTop} width={width} height={bandHeight} className="fill-accent-soft" />
          <polyline
            points={points}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-accent"
          />
        </svg>
      ) : summary.points.length === 1 ? (
        <p className="text-muted text-xs">A trend needs at least two compatible responses.</p>
      ) : null}
      <p className="text-muted text-xs">{coverageDescription(summary)} Pages show up to 20.</p>
    </div>
  )
}
