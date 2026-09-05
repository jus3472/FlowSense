'use client'

import { useEffect } from 'react'
import { MinimalHeader } from '@/components/layout/minimal-header'
import { Button, ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageTitle } from '@/components/ui/page-title'

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
      <main className="max-w-column mx-auto flex w-full flex-1 px-4 py-12 sm:px-8 sm:py-16">
        <Card className="flex w-full flex-col gap-6 sm:p-8">
          <PageTitle>This page did not load</PageTitle>
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
        </Card>
      </main>
    </div>
  )
}
