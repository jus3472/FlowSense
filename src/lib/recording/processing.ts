import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'

/** Three working stages, three terminal ones. Nothing else exists. */
export const WORK_STAGES = ['uploading', 'transcribing', 'scoring'] as const

export type WorkStage = (typeof WORK_STAGES)[number]
export type TerminalStage = 'done' | 'failed' | 'timed_out'
export type ProcessingStage = WorkStage | TerminalStage

export const STAGE_LABEL: Record<WorkStage, string> = {
  uploading: 'Saving',
  transcribing: 'Transcribing',
  scoring: 'Scoring',
}

export interface ProcessingState {
  stage: ProcessingStage
  /** Which stage failed, so the message can name it. */
  failedStage: WorkStage | null
  message: string | null
}

export const INITIAL_PROCESSING_STATE: ProcessingState = {
  stage: 'uploading',
  failedStage: null,
  message: null,
}

export function isTerminal(stage: ProcessingStage): boolean {
  return stage === 'done' || stage === 'failed' || stage === 'timed_out'
}

/** The real reason, never a bare status code. */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  if (typeof error === 'string' && error.trim().length > 0) return error
  return 'The connection failed.'
}

function terminalFor(stage: WorkStage, error: unknown): ProcessingState {
  return {
    stage: error instanceof RequestTimeoutError ? 'timed_out' : 'failed',
    failedStage: stage,
    message: describeError(error),
  }
}

/** One step per working stage, run in order. */
export interface PipelineSteps {
  /** Creates the attempt row, puts the audio in storage, records the path. */
  upload: () => Promise<void>
  transcribe: () => Promise<void>
  score: () => Promise<void>
}

/** Stage names read as progress, step names read as actions. */
const STEP_FOR_STAGE: Record<WorkStage, keyof PipelineSteps> = {
  uploading: 'upload',
  transcribing: 'transcribe',
  scoring: 'score',
}

/**
 * Runs every stage in order and always lands on a terminal state. Each step is
 * wrapped, so a rejection anywhere produces `failed` or `timed_out` rather than
 * leaving the caller mid flight. Steps are expected to be idempotent: a retry
 * re-runs this with the same closure, and completed work short circuits.
 */
export async function runProcessingPipeline(
  steps: PipelineSteps,
  onState: (state: ProcessingState) => void,
): Promise<ProcessingState> {
  const emit = (state: ProcessingState): ProcessingState => {
    onState(state)
    return state
  }

  for (const stage of WORK_STAGES) {
    emit({ stage, failedStage: null, message: null })
    try {
      await steps[STEP_FOR_STAGE[stage]]()
    } catch (error) {
      return emit(terminalFor(stage, error))
    }
  }

  return emit({ stage: 'done', failedStage: null, message: null })
}
