import { median, medianAbsoluteDeviation, ramp } from '@/lib/scoring/scale'
import type { PitchSample } from '@/lib/types/metrics'

export const MIN_VOICED_FRAMES = 40
const OCTAVE_TOLERANCE = 0.05

export interface EnergyAnalysis {
  /** Median absolute deviation of pitch in semitones, scaled by 1.4826. */
  semitones: number
  voiced_frames: number
  enough_audio: boolean
  descriptor: string
  component: number
}

/**
 * A frame sitting within 5% of double or half the speaker's median is an octave
 * error from the detector, not a real jump. Snapping it back matters because a
 * single doubled frame is a 12 semitone outlier.
 */
export function correctOctaves(values: readonly number[]): number[] {
  if (values.length === 0) return []
  const centre = median(values)
  if (centre <= 0) return [...values]

  return values.map((hz) => {
    if (Math.abs(hz - centre * 2) / (centre * 2) <= OCTAVE_TOLERANCE) return hz / 2
    if (Math.abs(hz - centre / 2) / (centre / 2) <= OCTAVE_TOLERANCE) return hz * 2
    return hz
  })
}

function describe(semitones: number): string {
  if (semitones < 1.6) return 'flat'
  if (semitones < 2.2) return 'steady'
  if (semitones <= 2.8) return 'varied'
  return 'animated'
}

/**
 * Uses the median absolute deviation rather than a standard deviation. MAD
 * shrugs off the outliers octave errors leave behind; a standard deviation does
 * not, and reported a monotone reading as animated in a previous build.
 */
export function analyseEnergy(pitch: readonly PitchSample[]): EnergyAnalysis {
  const usable = pitch.map((sample) => sample.hz).filter((hz) => Number.isFinite(hz) && hz > 0)

  if (usable.length < MIN_VOICED_FRAMES) {
    return {
      semitones: 0,
      voiced_frames: usable.length,
      enough_audio: false,
      descriptor: 'Not enough voiced audio',
      // Never charge for audio we could not measure.
      component: 1,
    }
  }

  const corrected = correctOctaves(usable)
  const centre = median(corrected)
  const semitoneValues = corrected.map((hz) => 12 * Math.log2(hz / centre))
  const spread = medianAbsoluteDeviation(semitoneValues)

  return {
    semitones: spread,
    voiced_frames: usable.length,
    enough_audio: true,
    descriptor: describe(spread),
    // Absolute, not relative to the speaker: 1.2 semitones earns nothing, 2.8 earns everything.
    component: ramp(spread, 2.8, 1.2),
  }
}
