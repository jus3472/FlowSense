import Link from 'next/link'
import { Wordmark } from '@/components/layout/wordmark'

export function MarketingHeader() {
  return (
    <header className="bg-surface">
      <div className="max-w-column mx-auto flex min-h-14 w-full items-center justify-between gap-4 px-4">
        <Link href="/" className="rounded-input flex min-h-11 items-center">
          <Wordmark />
        </Link>
        <Link
          href="/login"
          className="text-foreground hover:bg-surface-sunken flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition duration-150 ease-out"
        >
          Log in
        </Link>
      </div>
    </header>
  )
}
