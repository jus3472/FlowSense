import { evaluateDelivery } from '@/lib/scoring/v2/delivery'
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
    pitch: pitchTimeline(Array.from({ length: 80 }, () => 120)),
    ...overrides,
  }
}

describe('v2 delivery evaluator', () => {
  it('does not score insufficient voiced frames', () => {
    const result = evaluateDelivery(
      capture({ pitch: pitchTimeline(Array.from({ length: 20 }, () => 120)) }),
    )
    expect(result).toMatchObject({ category: 'delivery', status: 'not_checked', component: null })
    expect(result.deductions).toEqual([])
  })

  it('reports flat pitch with a bounded deduction', () => {
    const result = evaluateDelivery(capture())
    expect(result.status).toBe('scored')
    expect(result.component).toBe(0)
    expect(result.measurements.pitch_spread_semitones).toBeCloseTo(0, 6)
    expect(result.deductions[0]).toMatchObject({ check: 'pitch_variation', component_reduction: 1 })
  })

  it('recognizes useful pitch variation without a deduction', () => {
    const pitch = Array.from({ length: 80 }, (_value, index) => (index % 2 === 0 ? 100 : 145))
    const result = evaluateDelivery(capture({ pitch: pitchTimeline(pitch) }))
    expect(result).toMatchObject({ status: 'scored', component: 1 })
    expect(result.deductions).toEqual([])
    expect(result.evidence).toHaveLength(2)
  })

  it('corrects octave artifacts before measuring variation', () => {
    const pitch = Array.from({ length: 80 }, () => 120)
    for (let index = 0; index < pitch.length; index += 8) pitch[index] = 240
    const result = evaluateDelivery(capture({ pitch: pitchTimeline(pitch) }))
    expect(result.measurements.pitch_spread_semitones).toBeCloseTo(0, 6)
    expect(result.component).toBe(0)
  })

  it('does not score invalid capture values or timestamps', () => {
    const result = evaluateDelivery(
      capture({
        pitch: [
          { t_ms: 0, hz: 120 },
          { t_ms: Number.NaN, hz: 120 },
        ],
      }),
    )
    expect(result).toMatchObject({ status: 'not_checked', component: null })
    expect(result.warnings[0]).toContain('invalid')
  })

  it('does not score browser-throttled amplitude sampling', () => {
    const amplitude = amplitudeTimeline(4_000, [{ from_ms: 0, to_ms: 4_000, rms: 0.12 }]).filter(
      (sample) => sample.t_ms < 1_000 || sample.t_ms > 1_500,
    )
    const result = evaluateDelivery(capture({ amplitude }))
    expect(result).toMatchObject({ status: 'not_checked', component: null })
    expect(result.warnings[0]).toContain('interrupted')
  })

  it('does not score a contiguous short burst that misses the recording tail', () => {
    const amplitude = amplitudeTimeline(2_000, [{ from_ms: 0, to_ms: 2_000, rms: 0.12 }])
    const result = evaluateDelivery(capture({ amplitude }))
    expect(result).toMatchObject({ status: 'not_checked', component: null })
    expect(result.deductions).toEqual([])
    expect(result.warnings[0]).toContain('cover')
  })

  it('does not score nonmonotonic amplitude timestamps', () => {
    const amplitude = amplitudeTimeline(4_000, [{ from_ms: 0, to_ms: 4_000, rms: 0.12 }])
    amplitude[30] = { t_ms: 1_000, rms: 0.12 }
    const result = evaluateDelivery(capture({ amplitude }))
    expect(result).toMatchObject({ status: 'not_checked', component: null })
    expect(result.warnings[0]).toContain('invalid')
  })

  it.each([-0.1, Number.NaN])('does not score an invalid RMS value of %s', (rms) => {
    const amplitude = amplitudeTimeline(4_000, [{ from_ms: 0, to_ms: 4_000, rms: 0.12 }])
    amplitude[10] = { t_ms: 500, rms }
    const result = evaluateDelivery(capture({ amplitude }))
    expect(result).toMatchObject({ status: 'not_checked', component: null })
    expect(result.warnings[0]).toContain('invalid')
  })

  it.each([0, Number.NaN])('does not score an invalid sampling interval of %s', (interval) => {
    const result = evaluateDelivery(capture({ sample_interval_ms: interval }))
    expect(result).toMatchObject({ status: 'not_checked', component: null })
    expect(result.deductions).toEqual([])
    expect(result.warnings[0]).toContain('sampling interval')
  })
})
