import { FUNCTION_WORDS } from '@/lib/scoring/lexicon'
import { median } from '@/lib/scoring/scale'
import type { AmplitudeSample } from '@/lib/types/metrics'
import type { TranscriptWord } from '@/lib/deepgram/parse'

export const MIN_PAUSE_MS = 350
export const LONG_PAUSE_MS = 3000

const CALIBRATION_WINDOW_MS = 3000
const QUIET_DECILE = 0.1
/** Lower bound only: silence must clear the room by this much. */
const FLOOR_MULTIPLIER = 2.5
/** Silence is anything under this share of the speaker's own speech level. */
const SILENCE_FRACTION = 0.15
/** How far past a word-timed gap to look for the true amplitude boundary. */
const REFINE_WINDOW_MS = 250

/** Below this share of silence, a recording this long is not natural speech. */
const IMPLAUSIBLE_SILENCE_RATIO = 0.03
const SANITY_MIN_DURATION_MS = 20_000

export type PauseKind = 'mid_sentence' | 'clean'

export interface Pause {
  start_ms: number
  end_ms: number
  duration_ms: number
  kind: PauseKind
  /** The last content bearing word, with any fillers skipped over. */
  preceding_word: string
  /** True when a filler sat immediately before the gap. */
  after_filler: boolean
}

export interface PauseAnalysis {
  /** Inter-word gaps only. Leading and trailing silence are never classified. */
  pauses: Pause[]
  mid_sentence: Pause[]
  clean: Pause[]
  leading_silence_ms: number
  trailing_silence_ms: number
  /** Leading, inter-word, and trailing. Statistics and the pace denominator. */
  total_silence_ms: number
  longest_pause_ms: number
  speech_onset_ms: number | null
  noise_floor: number
  speech_level: number
  speech_threshold: number
  warnings: string[]
}

/** The room, measured from the quietest tenth of the opening seconds. */
export function calibrateNoiseFloor(samples: readonly AmplitudeSample[]): number {
  const opening = samples.filter((sample) => sample.t_ms < CALIBRATION_WINDOW_MS)
  const pool = opening.length > 0 ? opening : samples
  if (pool.length === 0) return 0

  const sorted = pool.map((sample) => sample.rms).sort((a, b) => a - b)
  const take = Math.max(1, Math.floor(sorted.length * QUIET_DECILE))
  const quietest = sorted.slice(0, take)
  return quietest.reduce((sum, value) => sum + value, 0) / quietest.length
}

/**
 * The speaker's own loudness, taken from frames that fall inside a spoken word.
 * Word timings make it possible to say which frames are definitely speech, which
 * is far more reliable than assuming the first three seconds contain silence.
 */
export function speechLevel(
  samples: readonly AmplitudeSample[],
  words: readonly TranscriptWord[],
): number {
  const inWord: number[] = []
  for (const sample of samples) {
    const seconds = sample.t_ms / 1000
    if (words.some((word) => seconds >= word.start && seconds <= word.end)) inWord.push(sample.rms)
  }
  if (inWord.length >= 5) return median(inWord)

  // No usable word timings. Fall back to the louder half of the recording.
  const all = samples.map((sample) => sample.rms)
  const centre = median(all)
  const loud = all.filter((value) => value >= centre)
  return loud.length > 0 ? median(loud) : centre
}

function refineBoundaries(
  samples: readonly AmplitudeSample[],
  threshold: number,
  fromMs: number,
  toMs: number,
): { start_ms: number; end_ms: number } {
  const window = samples.filter(
    (sample) => sample.t_ms >= fromMs - REFINE_WINDOW_MS && sample.t_ms <= toMs + REFINE_WINDOW_MS,
  )
  if (window.length === 0) return { start_ms: fromMs, end_ms: toMs }

  // The longest quiet run inside the window is the pause itself.
  let best: { start: number; end: number } | null = null
  let runStart: number | null = null

  for (let i = 0; i < window.length; i += 1) {
    const sample = window[i]!
    const quiet = sample.rms < threshold
    if (quiet && runStart === null) runStart = sample.t_ms
    if (!quiet && runStart !== null) {
      const run = { start: runStart, end: sample.t_ms }
      if (!best || run.end - run.start > best.end - best.start) best = run
      runStart = null
    }
  }
  if (runStart !== null) {
    const run = { start: runStart, end: window[window.length - 1]!.t_ms }
    if (!best || run.end - run.start > best.end - best.start) best = run
  }

  if (!best || best.end - best.start < MIN_PAUSE_MS) return { start_ms: fromMs, end_ms: toMs }
  return { start_ms: best.start, end_ms: best.end }
}

/**
 * Pauses are located from Deepgram's word timings, which resolve inter-word gaps
 * of 350ms and above reliably, and their edges are then sharpened against the
 * amplitude timeline. The previous amplitude-only version calibrated its
 * threshold from the quietest tenth of the opening seconds, which silently found
 * nothing whenever room tone sat above it: seven of nine real recordings
 * detected no pauses at all and every one of them scored full marks.
 */
export function analysePauses(
  samples: readonly AmplitudeSample[],
  words: readonly TranscriptWord[],
  durationMs: number,
  /** Word indices already counted as fillers, so classification can see past them. */
  fillerIndices: ReadonlySet<number> = new Set(),
): PauseAnalysis {
  const ordered = [...samples].sort((a, b) => a.t_ms - b.t_ms)
  const noiseFloor = calibrateNoiseFloor(ordered)
  const level = speechLevel(ordered, words)

  // Adaptive: a fraction of how loudly this speaker actually spoke, never below
  // the room. An absolute threshold cannot survive a noisy room.
  const threshold = Math.max(noiseFloor * FLOOR_MULTIPLIER, level * SILENCE_FRACTION)

  const firstWord = words[0]
  const lastWord = words[words.length - 1]

  const onsetFromAmplitude = ordered.find((sample) => sample.rms >= threshold)?.t_ms ?? null
  const speechOnset = onsetFromAmplitude

  const pauses: Pause[] = []
  for (let i = 0; i + 1 < words.length; i += 1) {
    const current = words[i]!
    const next = words[i + 1]!
    const gapStart = current.end * 1000
    const gapEnd = next.start * 1000
    if (gapEnd - gapStart < MIN_PAUSE_MS) continue

    const refined = refineBoundaries(ordered, threshold, gapStart, gapEnd)
    const duration = refined.end_ms - refined.start_ms
    if (duration < MIN_PAUSE_MS) continue

    // A hesitation sound is not a clause boundary. Walk back over any fillers to
    // the last word that carried meaning, and classify against that instead.
    const afterFiller = fillerIndices.has(i)
    let precedingAt = i
    while (precedingAt > 0 && fillerIndices.has(precedingAt)) precedingAt -= 1
    const preceding = words[precedingAt] ?? current

    const kind: PauseKind =
      duration >= LONG_PAUSE_MS ||
      // The speaker was audibly still assembling the sentence.
      afterFiller ||
      FUNCTION_WORDS.has(preceding.word.toLowerCase())
        ? 'mid_sentence'
        : 'clean'

    pauses.push({
      ...refined,
      duration_ms: duration,
      kind,
      preceding_word: preceding.word,
      after_filler: afterFiller,
    })
  }

  // Leading silence follows the same rule as time to first word: the amplitude
  // timeline wins when the two sources disagree by more than 200ms, because it
  // resolves onset far more precisely than a word timestamp.
  let leading = firstWord ? Math.max(0, firstWord.start * 1000) : 0
  if (onsetFromAmplitude !== null && Math.abs(onsetFromAmplitude - leading) > 200) {
    leading = onsetFromAmplitude
  }
  const trailing = lastWord ? Math.max(0, durationMs - lastWord.end * 1000) : 0
  const withinSpeech = pauses.reduce((sum, pause) => sum + pause.duration_ms, 0)
  const totalSilence = leading + withinSpeech + trailing

  const warnings: string[] = []
  const ratio = durationMs > 0 ? totalSilence / durationMs : 0
  if (durationMs > SANITY_MIN_DURATION_MS && ratio < IMPLAUSIBLE_SILENCE_RATIO) {
    warnings.push(
      `Pause detection found only ${(ratio * 100).toFixed(1)} percent silence across ` +
        `${(durationMs / 1000).toFixed(0)} seconds, which is implausible for natural speech. ` +
        `noise floor ${noiseFloor.toExponential(3)}, speech level ${level.toExponential(3)}, ` +
        `threshold ${threshold.toExponential(3)}, ${words.length} words. ` +
        `Check the capture timeline before trusting the pause and pace metrics.`,
    )
  }

  return {
    pauses,
    mid_sentence: pauses.filter((pause) => pause.kind === 'mid_sentence'),
    clean: pauses.filter((pause) => pause.kind === 'clean'),
    leading_silence_ms: leading,
    trailing_silence_ms: trailing,
    total_silence_ms: totalSilence,
    longest_pause_ms: pauses.reduce((max, pause) => Math.max(max, pause.duration_ms), 0),
    speech_onset_ms: speechOnset,
    noise_floor: noiseFloor,
    speech_level: level,
    speech_threshold: threshold,
    warnings,
  }
}
