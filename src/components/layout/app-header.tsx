import Link from 'next/link'
import { OverflowMenu } from '@/components/layout/overflow-menu'
import { Wordmark } from '@/components/layout/wordmark'

export function AppHeader() {
  return (
    <header className="bg-surface">
      <div className="max-w-column mx-auto flex min-h-14 w-full items-center justify-between gap-4 px-4">
        <Link href="/home" className="rounded-input flex min-h-11 items-center">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2">
          <Link
            href="/history"
            className="text-foreground hover:bg-surface-sunken flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition duration-150 ease-out"
          >
            History
          </Link>
          <OverflowMenu />
        </nav>
      </div>
    </header>
  )
}
