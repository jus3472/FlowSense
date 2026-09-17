'use client'

import { useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { liveTranscriptText, type LiveTranscriptState } from '@/lib/recording/live-transcript'

const RADIUS = 70
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function wordsIn(text: string): string[] {
  return text.trim().length > 0 ? text.trim().split(/\s+/) : []
}

function TranscriptWords({ text }: { text: string }) {
  const words = wordsIn(text)
  return words.map((word, index) => (
    <span key={`${index}:${word}`} className="animate-transcript-fade">
      {word}
      {index < words.length - 1 ? ' ' : null}
    </span>
  ))
}

interface RecordingStepProps {
  promptText: string
  maxDurationMs: number
  /** Live RMS from the sampler, read once per frame. */
  getLevel: () => number
  transcript: LiveTranscriptState
  transcriptUnavailable: boolean
  onStop: () => void
}

/**
 * Prompt, a ring that empties over 60 seconds, a pulse that follows the
 * microphone, and a compact live transcript. Final scoring still uses the
 * separately verified transcript made from the saved recording.
 *
 * The ring and the pulse are written straight to the DOM on each frame rather
 * than through state, so a 60 Hz meter does not drive 60 React renders a second.
 */
export function RecordingStep({
  promptText,
  maxDurationMs,
  getLevel,
  transcript,
  transcriptUnavailable,
  onStop,
}: RecordingStepProps) {
  const ringRef = useRef<SVGCircleElement>(null)
  const pulseRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const followLatestRef = useRef(true)
  const transcriptText = liveTranscriptText(transcript)

  const updateTranscriptFades = useCallback(() => {
    const panel = transcriptRef.current
    if (!panel) return
    const maxScrollTop = Math.max(0, panel.scrollHeight - panel.clientHeight)
    const hasOverflow = maxScrollTop > 1
    panel.dataset.fadeTop = String(hasOverflow && panel.scrollTop > 1)
    panel.dataset.fadeBottom = String(hasOverflow && panel.scrollTop < maxScrollTop - 1)
  }, [])

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

  useEffect(() => {
    const panel = transcriptRef.current
    if (!panel) return
    if (followLatestRef.current) panel.scrollTop = panel.scrollHeight
    updateTranscriptFades()
  }, [transcriptText, updateTranscriptFades])

  useEffect(() => {
    window.addEventListener('resize', updateTranscriptFades)
    return () => window.removeEventListener('resize', updateTranscriptFades)
  }, [updateTranscriptFades])

  const handleTranscriptScroll = () => {
    const panel = transcriptRef.current
    if (!panel) return
    followLatestRef.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight <= 16
    updateTranscriptFades()
  }

  return (
    <div className="max-w-column mx-auto flex min-h-[72vh] w-full flex-col items-center justify-center gap-8 py-4">
      <p className="prompt-display text-foreground max-w-[34rem] text-center text-xl">
        {promptText}
      </p>

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
              className="stroke-accent-visual"
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

      <div className="flex min-h-32 w-full max-w-[40rem] items-center justify-center px-4">
        <div className="max-h-40 w-full">
          <div
            ref={transcriptRef}
            role="log"
            aria-label="Words as you speak"
            aria-live="polite"
            aria-relevant="additions text"
            tabIndex={0}
            onScroll={handleTranscriptScroll}
            className="live-transcript-scroll max-h-40 w-full overflow-y-auto py-6 text-center"
          >
            {transcriptText ? (
              <div className="flex flex-col gap-2">
                <p className="text-accent-ink text-xl leading-8 font-medium">
                  <span data-testid="live-transcript-words">
                    <TranscriptWords text={transcriptText} />
                  </span>
                </p>
                {transcriptUnavailable ? (
                  <p role="status" className="text-muted text-xs">
                    Your words stopped appearing. Your recording continues.
                  </p>
                ) : null}
              </div>
            ) : transcriptUnavailable ? (
              <p className="text-muted text-sm leading-6">
                Your words are not appearing right now. Your recording continues.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <Button size="lg" variant="secondary" onClick={onStop}>
        Stop
      </Button>
    </div>
  )
}
