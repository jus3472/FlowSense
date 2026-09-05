import type { TranscriptWord } from '@/lib/deepgram/parse'
import { analyseFillers, type FillerHit } from '@/lib/scoring/fillers'
import { buildTokens } from '@/lib/scoring/tokens'
import type { V3MechanicallyOwnedSpan, V3TranscriptSpan } from '@/lib/scoring/v3/content/contracts'

export interface V3ContentEvidenceInput {
  mechanicallyOwned: V3MechanicallyOwnedSpan[]
  unreliableTranscriptSpans: V3TranscriptSpan[]
}

interface TokenEvidence {
  fillers: ReturnType<typeof analyseFillers>
  tokens: ReturnType<typeof buildTokens>
  unreliableTranscriptSpans: V3TranscriptSpan[]
}

function tokenEvidence(transcript: string, words: readonly TranscriptWord[]): TokenEvidence {
  const tokens = buildTokens(words, transcript)
  const fillers = analyseFillers(tokens, tokens.length)
  const unreliableTranscriptSpans = tokens.flatMap((token, index) => {
    const confidence = words[index]?.confidence
    return typeof confidence === 'number' && confidence >= 0 && confidence < 0.75
      ? [{ start: token.charStart, end: token.charEnd, confidence }]
      : []
  })
  return { fillers, tokens, unreliableTranscriptSpans }
}

function spansFromHits(
  hits: readonly FillerHit[],
  tokens: ReturnType<typeof buildTokens>,
  transcript: string,
): Array<Omit<V3MechanicallyOwnedSpan, 'category'> & { category: FillerHit['category'] }> {
  return hits.flatMap((hit) => {
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
}

/** Builds v3 exclusions and deductions. Lexical fillers and closers remain model-owned. */
export function v3ContentEvidenceInput(
  transcript: string,
  words: readonly TranscriptWord[],
): V3ContentEvidenceInput {
  const { fillers, tokens, unreliableTranscriptSpans } = tokenEvidence(transcript, words)
  const mechanicallyOwned = spansFromHits(
    fillers.hits.filter((hit) => hit.category === 'false_start'),
    tokens,
    transcript,
  ).map((span): V3MechanicallyOwnedSpan => ({ ...span, category: 'false_start' }))
  return { mechanicallyOwned, unreliableTranscriptSpans }
}
