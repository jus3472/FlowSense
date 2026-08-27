import { parseDeepgramResponse, type TranscriptWord } from '@/lib/deepgram/parse'

export interface StoredCompletedTranscription {
  transcript: string
  words: readonly TranscriptWord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validConfidence(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
  )
}

function validQuality(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value) || (value.status !== 'usable' && value.status !== 'degraded')) return false
  return (
    Array.isArray(value.diagnostics) && value.diagnostics.every((item) => typeof item === 'string')
  )
}

/**
 * Validates the transcript and timed words written by a completed Deepgram call.
 * JSONB is untrusted on read, so a retry falls back to the provider unless the
 * text, word ordering, timings, confidence, and optional duration agree.
 */
export function readStoredCompletedTranscription(
  transcript: unknown,
  metrics: unknown,
): StoredCompletedTranscription | null {
  if (typeof transcript !== 'string' || transcript.trim().length === 0 || !isRecord(metrics)) {
    return null
  }

  const stored = metrics.transcript
  if (
    !isRecord(stored) ||
    stored.provider !== 'deepgram' ||
    typeof stored.model !== 'string' ||
    stored.model.trim().length === 0 ||
    !validConfidence(stored.confidence) ||
    !Array.isArray(stored.words) ||
    stored.words.length === 0 ||
    !validQuality(stored.quality)
  ) {
    return null
  }

  const duration = stored.duration_seconds
  if (
    duration !== undefined &&
    duration !== null &&
    (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)
  ) {
    return null
  }

  try {
    const parsed = parseDeepgramResponse({
      ...(typeof duration === 'number' ? { metadata: { duration } } : {}),
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript,
                words: stored.words,
                ...(typeof stored.confidence === 'number' ? { confidence: stored.confidence } : {}),
              },
            ],
          },
        ],
      },
    })
    return { transcript: parsed.transcript, words: parsed.words }
  } catch {
    return null
  }
}
