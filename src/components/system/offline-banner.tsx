'use client'

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** Quiet, persistent, and out of the way until the connection actually drops. */
export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )

  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-surface-sunken text-muted px-4 py-2 text-center text-xs"
    >
      You are offline. Nothing saves until you reconnect.
    </div>
  )
}
