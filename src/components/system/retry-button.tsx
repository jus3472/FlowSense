'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'

/** Re-runs the server render for the current route. */
export function RetryButton({ children = 'Try again' }: { children?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [refreshing, setRefreshing] = useState(false)

  return (
    <div>
      <Button
        variant="secondary"
        loading={pending || refreshing}
        loadingLabel="Retrying"
        onClick={() => {
          setRefreshing(true)
          startTransition(() => {
            router.refresh()
            setRefreshing(false)
          })
        }}
      >
        {children}
      </Button>
    </div>
  )
}
