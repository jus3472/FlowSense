import Link from 'next/link'
import { HistoryNavLink } from '@/components/layout/history-nav-link'
import { OverflowMenu } from '@/components/layout/overflow-menu'
import { Wordmark } from '@/components/layout/wordmark'

export function AppHeader() {
  return (
    <header className="bg-background">
      <div className="max-w-column mx-auto flex min-h-14 w-full items-center justify-between gap-4 px-6 py-2">
        <Link href="/home" className="rounded-input flex min-h-11 items-center">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2">
          <HistoryNavLink />
          <OverflowMenu />
        </nav>
      </div>
    </header>
  )
}
