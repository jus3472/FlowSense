'use client'

import { useEffect, useState } from 'react'

interface CountdownStepProps {
  promptText: string
  seconds: number
  onComplete: () => void
}

/** Long enough to read the prompt, short enough to leave no room to plan. */
export function CountdownStep({ promptText, seconds, onComplete }: CountdownStepProps) {
  const [remainingMs, setRemainingMs] = useState(() => seconds * 1000)

  useEffect(() => {
    const totalMs = seconds * 1000
    const startedAt = performance.now()
    let fired = false

    const timer = setInterval(() => {
      const remaining = totalMs - (performance.now() - startedAt)
      if (remaining > 0) {
        setRemainingMs(remaining)
        return
      }
      if (fired) return
      fired = true
      clearInterval(timer)
      setRemainingMs(0)
      onComplete()
    }, 100)

    return () => clearInterval(timer)
    // onComplete is memoized by the flow, so the countdown never restarts.
  }, [seconds, onComplete])

  return (
    <div className="max-w-column mx-auto flex min-h-[68vh] w-full flex-col justify-center gap-12">
      <p className="prompt-display text-foreground text-2xl">{promptText}</p>
      <div className="border-border bg-surface shadow-card rounded-card flex flex-col items-center gap-2 border p-6">
        <p aria-hidden="true" className="numeric text-accent text-3xl">
          {Math.max(1, Math.ceil(remainingMs / 1000))}
        </p>
        <p role="status" className="text-muted text-sm">
          Recording starts in a moment
        </p>
      </div>
    </div>
  )
}
