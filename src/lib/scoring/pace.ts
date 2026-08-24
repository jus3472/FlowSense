import { clamp01 } from '@/lib/scoring/scale'

export interface PaceAnalysis {
  words_per_minute: number
  speaking_ms: number
  component: number
}

/**
 * Articulation rate, over speaking time rather than wall clock. Using wall clock
 * would make Pace partly a silence penalty, which is already charged under
 * mid-sentence pauses.
 */
export function analysePace(
  wordCount: number,
  durationMs: number,
  totalSilenceMs: number,
): PaceAnalysis {
  const speakingMs = Math.max(0, durationMs - totalSilenceMs)
  if (speakingMs <= 0 || wordCount <= 0) {
    return { words_per_minute: 0, speaking_ms: speakingMs, component: 0 }
  }

  const wpm = wordCount / (speakingMs / 60_000)
  return { words_per_minute: wpm, speaking_ms: speakingMs, component: paceComponent(wpm) }
}

/** Flat through the comfortable band, ramping down on both sides. */
export function paceComponent(wpm: number): number {
  if (!Number.isFinite(wpm) || wpm <= 0) return 0
  if (wpm >= 120 && wpm <= 175) return 1
  if (wpm < 120) {
    if (wpm <= 80) return 0.25
    return clamp01(0.25 + ((wpm - 80) / (120 - 80)) * 0.75)
  }
  if (wpm >= 220) return 0.35
  return clamp01(1 - ((wpm - 175) / (220 - 175)) * 0.65)
}
