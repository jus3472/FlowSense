'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'

const RADIUS = 70
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface RecordingStepProps {
  promptText: string
  maxDurationMs: number
  /** Live RMS from the sampler, read once per frame. */
  getLevel: () => number
  onStop: () => void
}

/**
 * Prompt, a ring that empties over 60 seconds, a pulse that follows the
 * microphone, and a stop button. Nothing else on purpose: reading your own words
 * back while speaking is distracting and changes how you speak, which corrupts
 * the very thing being measured.
 *
 * The ring and the pulse are written straight to the DOM on each frame rather
 * than through state, so a 60 Hz meter does not drive 60 React renders a second.
 */
export function RecordingStep({ promptText, maxDurationMs, getLevel, onStop }: RecordingStepProps) {
  const ringRef = useRef<SVGCircleElement>(null)
  const pulseRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const startedAt = performance.now()
    let frame = 0

    const tick = () => {
      const elapsed = performance.now() - startedAt
      const progress = Math.min(1, elapsed / maxDurationMs)

      const ring = ringRef.current
      if (ring) ring.style.strokeDashoffset = `${CIRCUMFERENCE * progress}`

      // Square root keeps quiet speech visible without letting loud speech peg
      // the meter at its maximum.
      const level = Math.min(1, Math.sqrt(Math.max(0, getLevel())) * 2.2)
      const pulse = pulseRef.current
      if (pulse) pulse.style.transform = `scale(${(0.55 + level * 0.65).toFixed(3)})`

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [maxDurationMs, getLevel])

  return (
    <div className="flex flex-col gap-8">
      <p className="text-foreground text-base">{promptText}</p>

      <div className="flex flex-col items-center gap-6">
        <div className="relative flex size-40 items-center justify-center">
          <svg viewBox="0 0 160 160" aria-hidden="true" className="absolute size-full -rotate-90">
            <circle
              cx="80"
              cy="80"
              r={RADIUS}
              fill="none"
              strokeWidth="6"
              className="stroke-surface-sunken"
            />
            <circle
              ref={ringRef}
              cx="80"
              cy="80"
              r={RADIUS}
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={0}
              className="stroke-accent"
            />
          </svg>
          <div
            ref={pulseRef}
            aria-hidden="true"
            className="bg-accent-soft size-16 rounded-full transition-transform duration-150 ease-out"
          />
        </div>

        <p role="status" className="text-foreground flex items-center gap-2 text-sm font-medium">
          <span aria-hidden="true" className="bg-accent size-2 rounded-full" />
          Recording
        </p>
      </div>

      <Button size="lg" fullWidth variant="secondary" onClick={onStop}>
        Stop
      </Button>
    </div>
  )
}
