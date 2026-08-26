/**
 * Word timings drive pause classification and time to first word in a later
 * prompt, so `start` and `end` are kept exactly as Deepgram reports them, in
 * seconds from the beginning of the audio.
 */
export interface TranscriptWord {
  word: string
  start: number
  end: number
  confidence?: number
}

export interface ParsedTranscript {
  /** Punctuated text from `punctuate=true`, with fillers left in place. */
  transcript: string
  words: TranscriptWord[]
  confidence: number | null
  durationSeconds: number | null
}

export class DeepgramParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeepgramParseError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Narrows a Deepgram pre-recorded response down to what FlowSense stores. An
 * empty transcript is valid, a missing alternative is not.
 */
export function parseDeepgramResponse(payload: unknown): ParsedTranscript {
  if (!isRecord(payload)) {
    throw new DeepgramParseError('Deepgram returned a response that was not an object.')
  }

  const results = payload.results
  if (!isRecord(results)) {
    throw new DeepgramParseError('Deepgram response is missing its results.')
  }

  const channels = results.channels
  const channel = Array.isArray(channels) ? channels[0] : undefined
  if (!isRecord(channel)) {
    throw new DeepgramParseError('Deepgram response contained no audio channel.')
  }

  const alternatives = channel.alternatives
  const alternative = Array.isArray(alternatives) ? alternatives[0] : undefined
  if (!isRecord(alternative)) {
    throw new DeepgramParseError('Deepgram response contained no transcript alternative.')
  }

  const transcript = typeof alternative.transcript === 'string' ? alternative.transcript : ''

  const rawWords = Array.isArray(alternative.words) ? alternative.words : []
  const words: TranscriptWord[] = []
  for (const entry of rawWords) {
    if (!isRecord(entry)) continue
    const word = typeof entry.word === 'string' ? entry.word : null
    const start = numberOrNull(entry.start)
    const end = numberOrNull(entry.end)
    if (word === null || start === null || end === null) continue
    const confidence = numberOrNull(entry.confidence)
    words.push({
      word,
      start,
      end,
      ...(confidence !== null && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
    })
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : null

  return {
    transcript,
    words,
    confidence: numberOrNull(alternative.confidence),
    durationSeconds: metadata ? numberOrNull(metadata.duration) : null,
  }
}
