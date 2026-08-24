'use client'

import { Button } from '@/components/ui/button'

interface ReadyStepProps {
  onStart: () => void
  requesting: boolean
}

/**
 * The prompt is deliberately absent from this screen. Reading the question
 * before starting would let someone pre-compose an answer, which makes time to
 * first word meaningless and defeats the point of the exercise.
 */
export function ReadyStep({ onStart, requesting }: ReadyStepProps) {
  return (
    <div className="flex min-h-[68vh] flex-col justify-center gap-8">
      <p className="section-label text-muted">One prompt, 60 seconds</p>
      <h1 className="prompt-display text-foreground text-2xl">Answer one prompt out loud</h1>
      <p className="text-muted text-base">
        The question appears with a countdown. Recording starts on its own when the countdown ends,
        and runs for up to 60 seconds.
      </p>
      <Button
        size="lg"
        fullWidth
        onClick={onStart}
        loading={requesting}
        loadingLabel="Waiting for your browser"
      >
        {"I'm ready"}
      </Button>
    </div>
  )
}
