import { median } from '@/lib/scoring/scale'

const OCTAVE_TOLERANCE = 0.05

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
