'use client'

import { useEffect } from 'react'

/**
 * Warns only while leaving can interrupt capture or lose an in-memory attempt.
 * Browser-provided wording is intentional: modern browsers ignore custom text.
 */
export function useActiveRecordingExitGuard(active: boolean) {
  useEffect(() => {
    if (!active) return

    const preventExit = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }

    window.addEventListener('beforeunload', preventExit)
    return () => window.removeEventListener('beforeunload', preventExit)
  }, [active])
}
