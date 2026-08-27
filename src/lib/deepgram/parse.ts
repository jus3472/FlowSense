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
  quality: DeepgramTranscriptQuality
}

export type DeepgramTranscriptQuality =
  | { status: 'usable'; diagnostics: readonly [] }
  | { status: 'degraded'; diagnostics: readonly string[] }

export interface DeepgramUnavailableQuality {
  status: 'unavailable'
  diagnostics: readonly string[]
}

export class DeepgramParseError extends Error {
  readonly quality: DeepgramUnavailableQuality

  constructor(message: string) {
    super(message)
    this.name = 'DeepgramParseError'
    this.quality = { status: 'unavailable', diagnostics: [message] }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizedWords(value: string): string[] {
  return (value.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []).map((word) =>
    word.toLocaleLowerCase().replaceAll('’', "'"),
  )
}

function malformed(message: string): never {
  throw new DeepgramParseError(message)
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

  if (typeof alternative.transcript !== 'string') {
    malformed('Deepgram transcript text was missing or malformed.')
  }
  const transcript = alternative.transcript

  if (!Array.isArray(alternative.words)) {
    malformed('Deepgram word evidence was missing or malformed.')
  }
  const rawWords = alternative.words
  const words: TranscriptWord[] = []
  const diagnostics: string[] = []
  let missingWordConfidence = 0
  let previousStart = -1
  let previousEnd = -1
  for (const [index, entry] of rawWords.entries()) {
    if (!isRecord(entry)) malformed(`Deepgram word ${index} was not an object.`)
    const word = typeof entry.word === 'string' && entry.word.trim().length > 0 ? entry.word : null
    const start = numberOrNull(entry.start)
    const end = numberOrNull(entry.end)
    if (word === null || start === null || end === null) {
      malformed(`Deepgram word ${index} was missing text or finite timings.`)
    }
    if (start < 0 || end <= start || start < previousStart || end < previousEnd) {
      malformed(`Deepgram word ${index} had invalid or nonmonotonic timings.`)
    }
    previousStart = start
    previousEnd = end

    let confidence: number | null = null
    if (entry.confidence === undefined) {
      missingWordConfidence += 1
    } else {
      confidence = numberOrNull(entry.confidence)
      if (confidence === null || confidence < 0 || confidence > 1) {
        malformed(`Deepgram word ${index} had an invalid confidence value.`)
      }
    }
    words.push({
      word,
      start,
      end,
      ...(confidence !== null ? { confidence } : {}),
    })
  }
  if (missingWordConfidence > 0) {
    diagnostics.push(
      `Deepgram omitted confidence for ${missingWordConfidence} recognized ${missingWordConfidence === 1 ? 'word' : 'words'}.`,
    )
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : null
  let durationSeconds: number | null = null
  if (metadata?.duration === undefined) {
    diagnostics.push('Deepgram response had no audio duration.')
  } else {
    const reportedDuration = numberOrNull(metadata.duration)
    if (reportedDuration === null || reportedDuration < 0) {
      malformed('Deepgram response had an invalid audio duration.')
    }
    durationSeconds = reportedDuration
    if (words.some((word) => word.end > reportedDuration + 0.25)) {
      malformed('Deepgram word timings extended beyond the reported audio duration.')
    }
  }

  const transcriptWords = normalizedWords(transcript)
  const recognizedWords = words.flatMap((word) => normalizedWords(word.word))
  if (
    transcriptWords.length !== recognizedWords.length ||
    transcriptWords.some((word, index) => word !== recognizedWords[index])
  ) {
    malformed('Deepgram transcript text and word evidence did not cover the same words in order.')
  }

  let confidence: number | null = null
  if (alternative.confidence === undefined) {
    diagnostics.push('Deepgram response had no overall confidence value.')
  } else {
    confidence = numberOrNull(alternative.confidence)
    if (confidence === null || confidence < 0 || confidence > 1) {
      malformed('Deepgram response had an invalid overall confidence value.')
    }
  }

  return {
    transcript,
    words,
    confidence,
    durationSeconds,
    quality:
      diagnostics.length === 0
        ? { status: 'usable', diagnostics: [] }
        : { status: 'degraded', diagnostics },
  }
}
