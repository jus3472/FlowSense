import { Card } from '@/components/ui/card'
import type { PracticeActivitySummary } from '@/lib/activity/server'

export function StreakDisplay({ summary }: { summary: PracticeActivitySummary }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="numeric text-foreground text-base font-medium">{summary.current} day streak</p>
      <p className={summary.todayActive ? 'text-positive text-sm' : 'text-muted text-sm'}>
        {summary.dailyGoal === 'complete'
          ? "Today's practice complete"
          : 'Complete 1 response today'}
      </p>
    </Card>
  )
}
