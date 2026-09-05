import Link from 'next/link'
import { Wordmark } from '@/components/layout/wordmark'

/** Used during sign up and onboarding, where navigation would be a distraction. */
export function MinimalHeader() {
  return (
    <header className="border-border bg-background border-b">
      <div className="max-w-page mx-auto flex min-h-16 w-full items-center px-4 sm:px-8 lg:px-12">
        <Link href="/" className="rounded-input flex min-h-11 items-center">
          <Wordmark />
        </Link>
      </div>
    </header>
  )
}
