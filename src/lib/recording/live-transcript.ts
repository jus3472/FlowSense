export interface LiveTranscriptState {
  finalized: readonly { start: number; text: string }[]
  interim: string
}

export const EMPTY_LIVE_TRANSCRIPT: LiveTranscriptState = { finalized: [], interim: '' }

interface DeepgramLiveResult {
  start: number
  text: string
  isFinal: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Accepts only the small, documented subset of Deepgram streaming results used by the UI. */
export function parseDeepgramLiveResult(payload: unknown): DeepgramLiveResult | null {
  if (!isRecord(payload) || payload.type !== 'Results') return null
  const channel = payload.channel
  if (!isRecord(channel) || !Array.isArray(channel.alternatives)) return null
  const alternative = channel.alternatives[0]
  if (!isRecord(alternative) || typeof alternative.transcript !== 'string') return null
  const start =
    typeof payload.start === 'number' && Number.isFinite(payload.start) ? payload.start : 0
  return {
    start,
    text: alternative.transcript.trim(),
    isFinal: payload.is_final === true,
  }
}

/** Replaces interim guesses and upserts final spans so repeated provider events never duplicate text. */
export function applyLiveTranscriptResult(
  state: LiveTranscriptState,
  result: DeepgramLiveResult,
): LiveTranscriptState {
  if (!result.isFinal) return { ...state, interim: result.text }
  if (result.text.length === 0) return { ...state, interim: '' }

  const finalized = state.finalized
    .filter((segment) => segment.start !== result.start)
    .concat({ start: result.start, text: result.text })
    .sort((left, right) => left.start - right.start)
  return { finalized, interim: '' }
}

export function liveTranscriptText(state: LiveTranscriptState): string {
  return [...state.finalized.map((segment) => segment.text), state.interim]
    .filter(Boolean)
    .join(' ')
}
