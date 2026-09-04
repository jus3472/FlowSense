import Link from 'next/link'
import { OverflowMenu } from '@/components/layout/overflow-menu'
import { PrimaryNavigation } from '@/components/layout/primary-navigation'
import { Wordmark } from '@/components/layout/wordmark'
import { StreakDisplay } from '@/components/home/streak-display'
import type { PracticeActivitySummary } from '@/lib/activity/server'

export function AppHeader({ activity }: { activity: PracticeActivitySummary | null }) {
  return (
    <header className="bg-background">
      <div className="max-w-column mx-auto grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 px-6 py-2 sm:grid-cols-[max-content_minmax(0,1fr)_max-content_max-content]">
        <Link
          href="/home"
          className="rounded-input col-start-1 row-start-1 flex min-h-11 min-w-max items-center whitespace-nowrap"
        >
          <Wordmark />
        </Link>
        <PrimaryNavigation />
        <div className="col-start-2 row-start-1 sm:col-start-3">
          {activity ? <StreakDisplay summary={activity} /> : null}
        </div>
        <div className="col-start-3 row-start-1 sm:col-start-4">
          <OverflowMenu />
        </div>
      </div>
    </header>
  )
}
