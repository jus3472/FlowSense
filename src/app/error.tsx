'use client'

import { useEffect } from 'react'
import { MinimalHeader } from '@/components/layout/minimal-header'
import { Button, ButtonLink } from '@/components/ui/button'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-dvh flex-col">
      <MinimalHeader />
      <main className="max-w-column mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-12">
        <h1 className="text-foreground text-xl font-semibold">This page did not load</h1>
        <p className="text-muted text-base">
          Something failed on our side. Your account and your recordings are not affected.
        </p>
        {error.digest ? (
          <p className="numeric text-muted text-xs">Reference {error.digest}</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
          <ButtonLink href="/home" variant="secondary" size="lg">
            Go to home
          </ButtonLink>
        </div>
      </main>
    </div>
  )
}
