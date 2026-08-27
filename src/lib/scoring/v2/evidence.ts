import type { TranscriptWord } from '@/lib/deepgram/parse'
import { buildTokens } from '@/lib/scoring/tokens'
import type { ScoreEvidence } from '@/lib/scoring/v2/contracts'

export const TRANSCRIPT_CHARACTER_COORDINATE = {
  space: 'transcript',
  unit: 'utf16_code_unit',
} as const

export const AUDIO_MILLISECOND_COORDINATE = {
  space: 'audio_timeline',
  unit: 'millisecond',
} as const

export const AUDIO_SECOND_COORDINATE = {
  space: 'audio_timeline',
  unit: 'second',
} as const

export interface TranscriptCharacterRange {
  from: number
  to: number
}

function sameQuote(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

export function validTranscriptCharacterRange(
  transcript: string,
  start: unknown,
  end: unknown,
  quote: unknown,
): TranscriptCharacterRange | null {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    start < 0 ||
    end <= start ||
    end > transcript.length ||
    typeof quote !== 'string' ||
    quote.length !== end - start ||
    !sameQuote(transcript.slice(start, end), quote)
  ) {
    return null
  }
  return { from: start, to: end }
}

/** Historical evidence without a coordinate is deliberately not guessed. */
export function exactTranscriptRange(
  transcript: string,
  evidence: Pick<ScoreEvidence, 'start' | 'end' | 'quote' | 'coordinate'>,
): TranscriptCharacterRange | null {
  if (
    evidence.coordinate?.space !== 'transcript' ||
    evidence.coordinate.unit !== 'utf16_code_unit'
  ) {
    return null
  }
  return validTranscriptCharacterRange(transcript, evidence.start, evidence.end, evidence.quote)
}

/**
 * Historical v2 filler evidence used source=transcript with exact integer
 * character offsets before coordinate metadata existed. That known shape is
 * safe to preserve; every other coordinate-less source remains fail-closed.
 */
export function exactOrLegacyTranscriptRange(
  transcript: string,
  evidence: Pick<ScoreEvidence, 'source' | 'start' | 'end' | 'quote' | 'coordinate'>,
): TranscriptCharacterRange | null {
  const exact = exactTranscriptRange(transcript, evidence)
  if (exact || evidence.coordinate !== undefined || evidence.source !== 'transcript') return exact
  return validTranscriptCharacterRange(transcript, evidence.start, evidence.end, evidence.quote)
}

export function transcriptEvidenceForWord(
  words: readonly TranscriptWord[],
  transcript: string | undefined,
  word: TranscriptWord,
  source: string,
  detail: string,
): ScoreEvidence {
  if (transcript !== undefined) {
    const index = words.indexOf(word)
    const token = index >= 0 ? buildTokens(words, transcript)[index] : undefined
    if (token && token.charEnd > token.charStart) {
      return {
        source,
        start: token.charStart,
        end: token.charEnd,
        coordinate: TRANSCRIPT_CHARACTER_COORDINATE,
        quote: transcript.slice(token.charStart, token.charEnd),
        detail,
      }
    }
  }

  return {
    source,
    start: word.start,
    end: word.end,
    coordinate: AUDIO_SECOND_COORDINATE,
    quote: word.word,
    detail,
  }
}
