'use client'

import { AudioPlayer } from '@/components/record/audio-player'
import { Button } from '@/components/ui/button'
import { STAGE_LABEL, type ProcessingState, type WorkStage } from '@/lib/recording/processing'

interface ProcessingStepProps {
  promptText: string
  audioUrl: string | null
  durationMs: number
  state: ProcessingState
  onRetry: () => void
}

const REASSURANCE: Record<WorkStage, string> = {
  uploading: 'Your recording is still here. Trying again sends it without recording you again.',
  transcribing: 'Your recording is already saved. Trying again uses the audio you just recorded.',
  scoring: 'Your recording and transcript are saved. Trying again only redoes the scoring.',
}

export function ProcessingStep({
  promptText,
  audioUrl,
  durationMs,
  state,
  onRetry,
}: ProcessingStepProps) {
  const stage = state.failedStage ?? 'uploading'

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted text-base">{promptText}</p>

      {/* The player appears the moment the blob exists, so there is something
          to do while the rest of the pipeline runs. */}
      {audioUrl ? <AudioPlayer key={audioUrl} src={audioUrl} durationMs={durationMs} /> : null}

      {state.stage === 'failed' || state.stage === 'timed_out' ? (
        <div className="flex flex-col gap-4">
          <h2 className="text-foreground text-lg font-semibold">
            {STAGE_LABEL[stage]} {state.stage === 'timed_out' ? 'timed out' : 'failed'}
          </h2>
          <p role="alert" className="text-negative text-sm">
            {state.message}
          </p>
          <p className="text-muted text-sm">{REASSURANCE[stage]}</p>
          <div>
            <Button size="lg" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <p role="status" className="text-muted text-sm">
          {state.stage === 'done' ? 'Opening your transcript' : STAGE_LABEL[state.stage]}
        </p>
      )}
    </div>
  )
}
