import Link from 'next/link'
import { Wordmark } from '@/components/layout/wordmark'

/** Used during sign up and onboarding, where navigation would be a distraction. */
export function MinimalHeader() {
  return (
    <header className="bg-surface">
      <div className="max-w-column mx-auto flex min-h-14 w-full items-center px-4">
        <Link href="/" className="rounded-input flex min-h-11 items-center">
          <Wordmark />
        </Link>
      </div>
    </header>
  )
}
