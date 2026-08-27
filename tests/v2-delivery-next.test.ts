import { readFileSync } from 'node:fs'
import {
  DELIVERY_NEXT_CALIBRATION_BASELINES,
  DELIVERY_NEXT_CALIBRATION_LABELS,
  runDeliveryNextCalibration,
  runDeliveryNextCalibrationCase,
} from '@/lib/scoring/v2/delivery-next-calibration'
import {
  DELIVERY_EVALUATOR_NEXT_VERSION,
  evaluateDeliveryNext,
} from '@/lib/scoring/v2/delivery-next'
import type { CaptureMetrics } from '@/lib/types/metrics'
import { amplitudeTimeline, pitchTimeline } from './helpers/transcript'
import { describe, expect, it } from 'vitest'

function capture(overrides: Partial<CaptureMetrics> = {}): CaptureMetrics {
  return {
    mime_type: 'audio/webm;codecs=opus',
    started_at: '2026-08-26T12:00:00.000Z',
    duration_ms: 4_000,
    sample_interval_ms: 50,
    amplitude: amplitudeTimeline(4_000, [{ from_ms: 0, to_ms: 4_000, rms: 0.12 }]),
    pitch: pitchTimeline(Array.from({ length: 80 }, (_value, index) => (index % 2 ? 145 : 100))),
    ...overrides,
  }
}

describe('next-version Delivery evaluator', () => {
  it('has an explicit opt-in version and combines reliable pitch and volume evidence', () => {
    const result = evaluateDeliveryNext(capture())
    expect(result).toMatchObject({
      evaluator_version: DELIVERY_EVALUATOR_NEXT_VERSION,
      category: 'delivery',
      status: 'scored',
      component: 1,
    })
    expect(result.measurements).toMatchObject({
      matched_volume_frames: 80,
      volume_stability_component: 1,
    })
    expect(result.evidence).toHaveLength(2)
  })

  it('responds conservatively to unstable voiced volume without replacing pitch evidence', () => {
    const amplitude = amplitudeTimeline(4_000, [{ from_ms: 0, to_ms: 4_000, rms: 0.12 }]).map(
      (sample, index) => ({ ...sample, rms: index % 2 === 0 ? 0.02 : 0.3 }),
    )
    const result = evaluateDeliveryNext(capture({ amplitude }))
    expect(result.status).toBe('scored')
    expect(result.component).toBe(0.75)
    expect(result.deductions).toEqual(
      expect.arrayContaining([expect.objectContaining({ check: 'volume_stability' })]),
    )
  })

  it('remains not_checked for quiet, invalid, insufficient, or throttled evidence', () => {
    const quiet = evaluateDeliveryNext(capture({ amplitude: amplitudeTimeline(4_000, [], 0) }))
    const insufficient = evaluateDeliveryNext(
      capture({ pitch: pitchTimeline(Array.from({ length: 20 }, () => 120)) }),
    )
    const invalid = evaluateDeliveryNext(capture({ sample_interval_ms: Number.NaN }))
    const throttled = evaluateDeliveryNext(
      capture({
        amplitude: amplitudeTimeline(4_000, [{ from_ms: 0, to_ms: 4_000, rms: 0.12 }]).filter(
          (sample) => sample.t_ms < 1_000 || sample.t_ms > 1_500,
        ),
      }),
    )
    for (const result of [quiet, insufficient, invalid, throttled]) {
      expect(result).toMatchObject({ status: 'not_checked', component: null, deductions: [] })
    }
  })

  it('does not manufacture pitch variation from octave artifacts', () => {
    const pitch = Array.from({ length: 80 }, () => 120)
    for (let index = 0; index < pitch.length; index += 8) pitch[index] = 240
    const result = evaluateDeliveryNext(capture({ pitch: pitchTimeline(pitch) }))
    expect(result.measurements.pitch_spread_semitones).toBe(0)
    expect(result.component).toBe(0.25)
    expect(result.deductions).toEqual(
      expect.arrayContaining([expect.objectContaining({ check: 'pitch_variation' })]),
    )
  })
})

describe('next-version Delivery calibration evidence', () => {
  it('matches checked-in deterministic baselines without changing current v2 calibration', () => {
    for (const label of DELIVERY_NEXT_CALIBRATION_LABELS) {
      expect(runDeliveryNextCalibrationCase(label), label).toEqual(
        DELIVERY_NEXT_CALIBRATION_BASELINES[label],
      )
    }
    expect(runDeliveryNextCalibration()).toMatchObject({ ok: true, differences: [] })
  })

  it('is not selected by the current route, rubric, assembler, or snapshot decoder', () => {
    for (const path of [
      'src/app/api/score/route.ts',
      'src/lib/scoring/v2/rubrics.ts',
      'src/lib/scoring/v2/assemble.ts',
      'src/lib/results/attempt-result.ts',
    ]) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toContain('evaluateDeliveryNext')
      expect(source, path).not.toContain('applyStructurePrecedenceVNext')
    }
  })
})
