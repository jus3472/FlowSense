import { describe, expect, it } from 'vitest'
import { MAX_PITCH_HZ, MIN_PITCH_HZ, computeRms, detectPitchHz } from '@/lib/recording/signal'

const SAMPLE_RATE = 48_000
const FRAME = 2048

function sine(hz: number, amplitude = 0.5, length = FRAME): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)
  }
  return out
}

/** A voice is not a pure tone, so the harmonics matter for a fair test. */
function voiced(hz: number, amplitude = 0.4, length = FRAME): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const t = (2 * Math.PI * i) / SAMPLE_RATE
    out[i] =
      amplitude * (Math.sin(hz * t) + 0.5 * Math.sin(2 * hz * t) + 0.25 * Math.sin(3 * hz * t))
  }
  return out
}

function seededNoise(length = FRAME): Float32Array {
  let seed = 42
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    out[i] = (seed / 2_147_483_648) * 2 - 1
  }
  return out
}

describe('computeRms', () => {
  it('is 0 for silence and for an empty frame', () => {
    expect(computeRms(new Float32Array(64))).toBe(0)
    expect(computeRms(new Float32Array(0))).toBe(0)
  })

  it('is the amplitude divided by root 2 for a sine', () => {
    expect(computeRms(sine(200, 1))).toBeCloseTo(Math.SQRT1_2, 2)
  })

  it('is the magnitude for a constant signal', () => {
    expect(computeRms(new Float32Array(64).fill(0.25))).toBeCloseTo(0.25, 6)
  })
})

describe('detectPitchHz', () => {
  it.each([85, 110, 150, 220, 330])('recovers a %i Hz voice', (hz) => {
    const detected = detectPitchHz(voiced(hz), SAMPLE_RATE)
    expect(detected).not.toBeNull()
    expect(detected as number).toBeGreaterThan(hz * 0.97)
    expect(detected as number).toBeLessThan(hz * 1.03)
  })

  it.each([100, 200, 300])('recovers a pure %i Hz tone', (hz) => {
    const detected = detectPitchHz(sine(hz), SAMPLE_RATE)
    expect(detected).not.toBeNull()
    expect(detected as number).toBeCloseTo(hz, 0)
  })

  it('returns null for silence', () => {
    expect(detectPitchHz(new Float32Array(FRAME), SAMPLE_RATE)).toBeNull()
  })

  it('returns null for a frame below the silence floor', () => {
    expect(detectPitchHz(sine(150, 0.0001), SAMPLE_RATE)).toBeNull()
  })

  it('rejects noise, which has no periodicity to lock onto', () => {
    expect(detectPitchHz(seededNoise(), SAMPLE_RATE)).toBeNull()
  })

  it('never reports a value outside the 60 to 400 Hz window', () => {
    for (const hz of [70, 90, 120, 180, 240, 380]) {
      const detected = detectPitchHz(voiced(hz), SAMPLE_RATE)
      if (detected === null) continue
      expect(detected).toBeGreaterThanOrEqual(MIN_PITCH_HZ)
      expect(detected).toBeLessThanOrEqual(MAX_PITCH_HZ)
    }
  })

  it('honours a stricter voicing gate', () => {
    // A clean tone passes at 0.5 and fails once the gate is set above 1.
    expect(detectPitchHz(voiced(140), SAMPLE_RATE, { confidenceThreshold: 0.5 })).not.toBeNull()
    expect(detectPitchHz(voiced(140), SAMPLE_RATE, { confidenceThreshold: 1.01 })).toBeNull()
  })

  it('handles a 44.1 kHz stream as well as 48 kHz', () => {
    const rate = 44_100
    const frame = new Float32Array(FRAME)
    for (let i = 0; i < FRAME; i += 1) frame[i] = 0.4 * Math.sin((2 * Math.PI * 160 * i) / rate)
    const detected = detectPitchHz(frame, rate)
    expect(detected).not.toBeNull()
    expect(detected as number).toBeCloseTo(160, 0)
  })

  it('returns null for degenerate input', () => {
    expect(detectPitchHz(new Float32Array(0), SAMPLE_RATE)).toBeNull()
    expect(detectPitchHz(sine(150), 0)).toBeNull()
  })
})
