'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { STAGE_LABEL, type ProcessingState, type WorkStage } from '@/lib/recording/processing'

interface ProcessingStepProps {
  promptText: string
  state: ProcessingState
  onRetry: () => void
}

const REASSURANCE: Record<WorkStage, string> = {
  uploading: 'Your recording is still here. Trying again sends it without recording you again.',
  transcribing: 'Your recording is already saved. Trying again uses the audio you just recorded.',
  scoring: 'Your recording and transcript are saved. Trying again only redoes the scoring.',
}

const FAILURE_TITLE: Record<WorkStage, { failed: string; timed_out: string }> = {
  uploading: {
    failed: 'Your response could not be saved',
    timed_out: 'Saving your response took too long',
  },
  transcribing: {
    failed: 'Your transcript could not be prepared',
    timed_out: 'Transcribing your response took too long',
  },
  scoring: {
    failed: 'Your feedback could not be prepared',
    timed_out: 'Preparing your feedback took too long',
  },
}

export function ProcessingStep({ promptText, state, onRetry }: ProcessingStepProps) {
  const stage = state.failedStage ?? 'uploading'

  return (
    <div className="max-w-column mx-auto flex w-full flex-col gap-6">
      <p className="prompt-display text-muted text-lg">{promptText}</p>

      {state.stage === 'failed' || state.stage === 'timed_out' ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-foreground text-lg font-semibold">
            {FAILURE_TITLE[stage][state.stage]}
          </h2>
          <p
            role="alert"
            className="bg-negative-soft text-negative rounded-input px-4 py-3 text-sm"
          >
            {state.message}
          </p>
          <p className="text-muted text-sm">{REASSURANCE[stage]}</p>
          <div>
            <Button size="lg" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex min-h-52 flex-col items-center justify-center gap-6 text-center">
          <svg
            viewBox="0 0 48 48"
            aria-hidden="true"
            data-processing-spinner="true"
            className="text-accent-visual size-12 animate-spin motion-reduce:animate-none"
            fill="none"
          >
            <circle
              cx="24"
              cy="24"
              r="18"
              stroke="currentColor"
              strokeOpacity="0.18"
              strokeWidth="4"
            />
            <path
              d="M24 6a18 18 0 0 1 18 18"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="4"
            />
          </svg>
          <div className="max-w-reading flex flex-col gap-2">
            <h2 className="text-foreground text-lg font-semibold">Preparing your feedback</h2>
            <p role="status" aria-live="polite" className="text-muted text-base">
              {state.stage === 'done' ? 'Opening your result' : STAGE_LABEL[state.stage]}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
