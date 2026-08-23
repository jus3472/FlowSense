/**
 * Signal analysis for the capture timelines. Pure functions over sample arrays
 * so they can be tested against synthetic waveforms rather than a live
 * microphone. Prompt 3 derives its delivery metrics from what these produce, so
 * the values stay raw and unsmoothed.
 */

export const MIN_PITCH_HZ = 60
export const MAX_PITCH_HZ = 400

/** Peak must reach this fraction of the zero lag value for a frame to count as voiced. */
export const VOICING_THRESHOLD = 0.5

/** How close a shorter lag must come to the best score before it is preferred. */
const OCTAVE_ACCEPTANCE = 0.9

/** Root mean square amplitude of a frame, in the same units as the samples. */
export function computeRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] ?? 0
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}

/**
 * Box average decimation. Pitch never exceeds 400 Hz, so working at roughly
 * 8 kHz keeps autocorrelation off the main thread's critical path, and the
 * averaging doubles as the anti alias filter.
 */
function decimate(samples: ArrayLike<number>, factor: number): Float32Array {
  if (factor <= 1) {
    const copy = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i += 1) copy[i] = samples[i] ?? 0
    return copy
  }

  const length = Math.floor(samples.length / factor)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    let sum = 0
    const base = i * factor
    for (let k = 0; k < factor; k += 1) sum += samples[base + k] ?? 0
    out[i] = sum / factor
  }
  return out
}

function removeDcOffset(samples: Float32Array): void {
  let mean = 0
  for (let i = 0; i < samples.length; i += 1) mean += samples[i] ?? 0
  mean /= samples.length || 1
  for (let i = 0; i < samples.length; i += 1) samples[i] = (samples[i] ?? 0) - mean
}

export interface PitchOptions {
  minHz?: number
  maxHz?: number
  /** Voicing gate as a fraction of the zero lag value. */
  confidenceThreshold?: number
  targetSampleRate?: number
  /** Frames quieter than this are treated as silence and skipped. */
  silenceRms?: number
}

/**
 * Fundamental frequency by normalized autocorrelation, or null when the frame
 * is unvoiced or lands outside the human speaking range.
 *
 * The correlation is normalized against the energy of both overlapping windows,
 * so a perfectly periodic frame scores 1.0 at its true lag no matter how long
 * the lag is. That makes the zero lag value exactly 1.0 and the 0.5 voicing gate
 * mean the same thing at 60 Hz as it does at 400 Hz. Normalizing against the
 * whole frame instead would quietly penalize low voices, whose longer lags leave
 * a shorter overlap.
 */
export function detectPitchHz(
  samples: ArrayLike<number>,
  sampleRate: number,
  options: PitchOptions = {},
): number | null {
  const {
    minHz = MIN_PITCH_HZ,
    maxHz = MAX_PITCH_HZ,
    confidenceThreshold = VOICING_THRESHOLD,
    targetSampleRate = 8000,
    silenceRms = 0.001,
  } = options

  if (samples.length === 0 || sampleRate <= 0) return null
  if (computeRms(samples) < silenceRms) return null

  const factor = Math.max(1, Math.round(sampleRate / targetSampleRate))
  const frame = decimate(samples, factor)
  const rate = sampleRate / factor
  const n = frame.length
  if (n < 8) return null

  removeDcOffset(frame)

  const minLag = Math.max(1, Math.floor(rate / maxHz))
  const maxLag = Math.min(Math.ceil(rate / minHz), n - 2)
  if (maxLag <= minLag) return null

  // Prefix sums of squares turn every window energy into two lookups.
  const energy = new Float64Array(n + 1)
  for (let i = 0; i < n; i += 1) {
    const value = frame[i] ?? 0
    energy[i + 1] = (energy[i] ?? 0) + value * value
  }
  const energyBetween = (from: number, to: number) => (energy[to] ?? 0) - (energy[from] ?? 0)
  if (energyBetween(0, n) <= 0) return null

  const normalized = new Float64Array(maxLag + 2)
  let bestLag = -1
  let bestScore = 0

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const overlap = n - lag
    let product = 0
    for (let i = 0; i < overlap; i += 1) product += (frame[i] ?? 0) * (frame[i + lag] ?? 0)

    const denominator = Math.sqrt(energyBetween(0, overlap) * energyBetween(lag, lag + overlap))
    const score = denominator > 0 ? product / denominator : 0
    normalized[lag] = score

    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  if (bestLag < 0 || bestScore < confidenceThreshold) return null

  // Every integer multiple of the true period correlates just as well, so the
  // global maximum lands on an octave, or two, below the real pitch as often as
  // not. Taking the first local peak that comes within reach of the best score
  // is the standard fix, and it is what keeps a 300 Hz voice from being
  // reported as 100 Hz.
  let chosenLag = bestLag
  const acceptable = bestScore * OCTAVE_ACCEPTANCE
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const score = normalized[lag] ?? 0
    if (score < acceptable) continue
    const rising = lag === minLag || score >= (normalized[lag - 1] ?? 0)
    const falling = lag === maxLag || score >= (normalized[lag + 1] ?? 0)
    if (rising && falling) {
      chosenLag = lag
      break
    }
  }

  // Parabolic interpolation recovers the fraction of a sample the integer lag
  // grid throws away, which matters most at the top of the range where one
  // sample of lag is worth more than 20 Hz.
  const before = normalized[chosenLag - 1] ?? 0
  const peak = normalized[chosenLag] ?? 0
  const after = normalized[chosenLag + 1] ?? 0
  const curvature = before - 2 * peak + after
  const shift = curvature === 0 ? 0 : (0.5 * (before - after)) / curvature
  const refinedLag = chosenLag + (Number.isFinite(shift) && Math.abs(shift) <= 1 ? shift : 0)
  if (refinedLag <= 0) return null

  const hz = rate / refinedLag
  if (hz < minHz || hz > maxHz) return null
  return hz
}
