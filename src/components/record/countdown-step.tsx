'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

interface CountdownStepProps {
  promptText: string
  seconds: number
  onComplete: () => void
}

/** Long enough to read the prompt, short enough to leave no room to plan. */
export function CountdownStep({ promptText, seconds, onComplete }: CountdownStepProps) {
  const [remainingMs, setRemainingMs] = useState(() => seconds * 1000)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const completedRef = useRef(false)

  const complete = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    if (timerRef.current !== null) clearInterval(timerRef.current)
    timerRef.current = null
    setRemainingMs(0)
    onComplete()
  }, [onComplete])

  useEffect(() => {
    const totalMs = seconds * 1000
    const startedAt = performance.now()

    timerRef.current = setInterval(() => {
      const remaining = totalMs - (performance.now() - startedAt)
      if (remaining > 0) {
        setRemainingMs(remaining)
        return
      }
      complete()
    }, 100)

    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [seconds, complete])

  return (
    <div className="max-w-column mx-auto flex min-h-[68vh] w-full flex-col justify-center gap-12">
      <p className="prompt-display text-foreground text-2xl">{promptText}</p>
      <div className="border-border bg-surface shadow-card rounded-card flex flex-col items-center gap-4 border p-6">
        <p aria-hidden="true" className="numeric text-accent-ink text-3xl">
          {Math.max(1, Math.ceil(remainingMs / 1000))}
        </p>
        <p role="status" className="text-muted text-sm">
          Recording starts in a moment
        </p>
        <Button size="md" variant="secondary" onClick={complete}>
          Start now
        </Button>
      </div>
    </div>
  )
}
