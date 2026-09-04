import type { TranscriptWord } from '@/lib/deepgram/parse'
import { analyseFillers } from '@/lib/scoring/fillers'
import { buildTokens } from '@/lib/scoring/tokens'
import type { V3MechanicallyOwnedSpan, V3TranscriptSpan } from '@/lib/scoring/v3/content/contracts'

export interface V3ContentEvidenceInput {
  mechanicallyOwned: V3MechanicallyOwnedSpan[]
  unreliableTranscriptSpans: V3TranscriptSpan[]
}

/** Builds the exact evidence exclusions shared by production scoring and live diagnostics. */
export function v3ContentEvidenceInput(
  transcript: string,
  words: readonly TranscriptWord[],
): V3ContentEvidenceInput {
  const tokens = buildTokens(words, transcript)
  const fillers = analyseFillers(tokens, tokens.length)
  const mechanicallyOwned = fillers.hits.flatMap((hit) => {
    const selected = hit.token_indices.map((index) => tokens[index]).filter(Boolean)
    const first = selected[0]
    const last = selected.at(-1)
    return first && last
      ? [
          {
            start: first.charStart,
            end: last.charEnd,
            text: transcript.slice(first.charStart, last.charEnd),
            category: hit.category,
          },
        ]
      : []
  })
  const unreliableTranscriptSpans = tokens.flatMap((token, index) => {
    const confidence = words[index]?.confidence
    return typeof confidence === 'number' && confidence >= 0 && confidence < 0.75
      ? [{ start: token.charStart, end: token.charEnd, confidence }]
      : []
  })
  return { mechanicallyOwned, unreliableTranscriptSpans }
}
