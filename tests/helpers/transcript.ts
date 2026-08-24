import { buildTokens, normalizeWord, type Token } from '@/lib/scoring/tokens'
import type { TranscriptWord } from '@/lib/deepgram/parse'

/** Mirrors Deepgram: lowercase words with no punctuation, plus the punctuated text. */
export function wordsFrom(
  transcript: string,
  wordsPerSecond = 3,
  offsetSeconds = 0,
): TranscriptWord[] {
  const raws = transcript.match(/\S+/g) ?? []
  const step = 1 / wordsPerSecond
  return raws.map((raw, index) => ({
    word: normalizeWord(raw),
    start: Number((offsetSeconds + index * step).toFixed(3)),
    end: Number((offsetSeconds + index * step + step * 0.8).toFixed(3)),
  }))
}

export function tokensFrom(transcript: string): Token[] {
  return buildTokens(wordsFrom(transcript), transcript)
}

export interface Segment {
  from_ms: number
  to_ms: number
  rms: number
}

/** Builds a 20 samples per second amplitude timeline from loud and quiet spans. */
export function amplitudeTimeline(
  durationMs: number,
  segments: readonly Segment[],
  quietRms = 0.002,
  intervalMs = 50,
) {
  const samples = []
  for (let t = 0; t < durationMs; t += intervalMs) {
    const segment = segments.find((entry) => t >= entry.from_ms && t < entry.to_ms)
    samples.push({ t_ms: t, rms: segment ? segment.rms : quietRms })
  }
  return samples
}

export function pitchTimeline(values: readonly number[], intervalMs = 50) {
  return values.map((hz, index) => ({ t_ms: index * intervalMs, hz }))
}
