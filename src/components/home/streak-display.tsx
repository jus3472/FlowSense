import type { PracticeActivitySummary } from '@/lib/activity/server'
import { HelpTooltip } from '@/components/ui/help-tooltip'

export function StreakDisplay({ summary }: { summary: PracticeActivitySummary }) {
  const todayLabel = summary.todayActive
    ? "Today's practice complete"
    : "Today's practice not complete"
  const label = `${summary.current} day streak. ${todayLabel}.`

  return (
    <HelpTooltip
      label={label}
      active={summary.todayActive}
      className={`focus-visible:ring-accent-ink focus-visible:ring-offset-background flex min-h-11 items-center gap-1.5 rounded-full px-3 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
        summary.todayActive ? 'bg-accent text-accent-fg' : 'bg-surface-sunken text-muted'
      }`}
    >
      <span className="relative flex size-5 items-center justify-center" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill={summary.todayActive ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.2 2.8c.4 3.2-1.4 4.6-3 6.2-1.3 1.3-2.2 2.8-2.2 4.9a5 5 0 0 0 10 0c0-3.2-1.8-6.1-4.8-11.1Z" />
          <path d="M12 11.1c.1 1.4-1.5 2.2-1.5 3.7a1.7 1.7 0 0 0 3.4 0c0-1.2-.6-2.4-1.9-3.7Z" />
        </svg>
        {summary.todayActive ? (
          <svg
            viewBox="0 0 12 12"
            className="bg-surface text-positive absolute -right-1 -bottom-1 size-3 rounded-full"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m2.5 6 2.2 2.1 4.8-4.6" />
          </svg>
        ) : null}
      </span>
      <span className="numeric text-sm font-semibold">{summary.current}</span>
    </HelpTooltip>
  )
}
