import type { TranscriptWord } from '@/lib/deepgram/parse'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'
import type { V3ScorePayload } from '@/lib/scoring/v3/contracts'

export interface StoredAttemptResultInput {
  id: string
  promptText: string
  transcript: string | null
  durationMs: number | null
  createdAt: string
  audioUrl: string | null
  score: number | null
  sectionScores: unknown
  metrics: unknown
  contentResult: unknown
}

export type ReadAttemptResult =
  | { kind: 'v3'; payload: V3ScorePayload }
  | { kind: 'incomplete' }
  | {
      kind: 'unsupported_version'
      scoreVersion: string | null
      rubricVersion: string | null
    }
  | { kind: 'malformed' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isTranscriptWords(value: unknown): value is TranscriptWord[] {
  if (!Array.isArray(value)) return false
  let previousStart = -1
  let previousEnd = -1
  for (const word of value) {
    if (
      !isRecord(word) ||
      typeof word.word !== 'string' ||
      word.word.trim().length === 0 ||
      !finiteNumber(word.start) ||
      !finiteNumber(word.end) ||
      word.start < 0 ||
      word.end <= word.start ||
      word.start < previousStart ||
      word.end < previousEnd ||
      ('confidence' in word &&
        (!finiteNumber(word.confidence) || word.confidence < 0 || word.confidence > 1))
    ) {
      return false
    }
    previousStart = word.start
    previousEnd = word.end
  }
  return true
}

/** Safely narrows stored timed words for deduction annotations without reinterpreting scores. */
export function storedTranscriptWords(metrics: unknown): TranscriptWord[] {
  if (!isRecord(metrics) || !isRecord(metrics.transcript)) return []
  return isTranscriptWords(metrics.transcript.words) ? metrics.transcript.words : []
}

/** Interprets persisted result JSONB at the single current-version boundary. */
export function readAttemptResult(input: StoredAttemptResultInput): ReadAttemptResult {
  const snapshot = decodeStoredSectionSnapshot(input.sectionScores)
  if (snapshot.kind === 'v3') return { kind: 'v3', payload: snapshot.payload }
  if (snapshot.kind === 'unsupported_version') return snapshot
  if (snapshot.kind === 'malformed') return { kind: 'malformed' }

  if (input.score === null && input.sectionScores === null && input.contentResult === null) {
    return { kind: 'incomplete' }
  }
  return { kind: 'malformed' }
}
