'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'

export default function AppErrorBoundary({
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
    <PageShell width="column">
      <Card className="flex flex-col gap-6 sm:p-8">
        <PageTitle>This page did not load</PageTitle>
        <p className="text-muted text-base">
          Something failed on our side. Your account and your recordings are not affected.
        </p>
        {error.digest ? (
          <p className="numeric text-muted text-xs">Reference {error.digest}</p>
        ) : null}
        <Button size="lg" className="w-fit" onClick={reset}>
          Try again
        </Button>
      </Card>
    </PageShell>
  )
}
