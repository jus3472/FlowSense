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
        <main className="max-w-column mx-auto flex w-full flex-col gap-6 px-4 py-12">
          <h1 className="text-foreground text-xl font-semibold">FlowSense did not load</h1>
          <p className="text-muted text-base">
            Reload the page. If it keeps failing, try again in a few minutes.
          </p>
          <div>
            <button
              type="button"
              onClick={reset}
              className="bg-accent text-accent-fg inline-flex min-h-14 items-center justify-center rounded-full px-8 text-base font-medium"
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
