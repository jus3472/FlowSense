import { ramp } from '@/lib/scoring/scale'
import type { TranscriptWord } from '@/lib/deepgram/parse'

const DISAGREEMENT_MS = 200
/** Below this, the number is almost certainly wrong rather than impressive. */
const IMPLAUSIBLE_MS = 60

export interface TimeToFirstWordAnalysis {
  seconds: number
  transcript_ms: number | null
  amplitude_ms: number | null
  source: 'transcript' | 'amplitude' | 'none'
  component: number
  warning: string | null
}

/**
 * Deliberately unclamped. A previous build floored this at 250ms, which masked a
 * broken calculation that reported exactly 0.3 seconds on every attempt for
 * weeks. An implausible value is logged and kept, never quietly rounded away.
 */
export function analyseTimeToFirstWord(
  words: readonly TranscriptWord[],
  speechOnsetMs: number | null,
): TimeToFirstWordAnalysis {
  const first = words[0]
  const transcriptMs = first ? first.start * 1000 : null

  if (transcriptMs === null && speechOnsetMs === null) {
    return {
      seconds: 0,
      transcript_ms: null,
      amplitude_ms: null,
      source: 'none',
      component: 1,
      warning: 'No words and no speech onset, so nothing could be measured.',
    }
  }

  let chosen = transcriptMs ?? speechOnsetMs ?? 0
  let source: 'transcript' | 'amplitude' = transcriptMs === null ? 'amplitude' : 'transcript'

  // The amplitude timeline resolves onset far more precisely than word timings.
  if (transcriptMs !== null && speechOnsetMs !== null) {
    if (Math.abs(transcriptMs - speechOnsetMs) > DISAGREEMENT_MS) {
      chosen = speechOnsetMs
      source = 'amplitude'
    }
  }

  const warning =
    chosen < IMPLAUSIBLE_MS
      ? `Time to first word came back as ${Math.round(chosen)}ms, which is implausibly low. Check the capture timeline rather than clamping it.`
      : null

  return {
    seconds: chosen / 1000,
    transcript_ms: transcriptMs,
    amplitude_ms: speechOnsetMs,
    source,
    component: ramp(chosen / 1000, 2.5, 12),
    warning,
  }
}
