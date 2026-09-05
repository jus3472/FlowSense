'use client'

import { useEffect } from 'react'
import { themeInitScript } from '@/lib/theme'
import './globals.css'

/**
 * Replaces the root layout when it is the layout itself that failed, so this
 * file re-declares the document shell and re-applies the theme by hand.
 */
export default function GlobalError({
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-background min-h-dvh">
        <main className="max-w-column mx-auto flex w-full px-4 py-12 sm:px-8 sm:py-16">
          <div className="border-border bg-surface shadow-card rounded-card flex w-full flex-col gap-6 border p-6 sm:p-8">
            <h1 className="prompt-display text-foreground text-2xl">FlowSense did not load</h1>
            <p className="text-muted text-base">
              Reload the page. If it keeps failing, try again in a few minutes.
            </p>
            <button
              type="button"
              onClick={reset}
              className="bg-accent text-accent-fg rounded-input inline-flex min-h-14 items-center justify-center px-8 text-base font-medium"
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
