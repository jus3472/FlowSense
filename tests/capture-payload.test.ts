import { describe, expect, it } from 'vitest'
import { parseCaptureMetrics } from '@/lib/recording/capture-payload'

const VALID = {
  mime_type: 'audio/webm;codecs=opus',
  started_at: '2026-08-23T12:00:00.000Z',
  duration_ms: 12_400,
  sample_interval_ms: 50,
  amplitude: [
    { t_ms: 0, rms: 0.02 },
    { t_ms: 50, rms: 0.14 },
  ],
  pitch: [{ t_ms: 50, hz: 132.4 }],
}

describe('parseCaptureMetrics', () => {
  it('keeps a well formed payload intact', () => {
    expect(parseCaptureMetrics(VALID)).toEqual(VALID)
  })

  it('accepts empty timelines, which is what silence produces', () => {
    const parsed = parseCaptureMetrics({ ...VALID, amplitude: [], pitch: [] })
    expect(parsed?.amplitude).toEqual([])
    expect(parsed?.pitch).toEqual([])
  })

  it('drops malformed samples instead of storing them', () => {
    const parsed = parseCaptureMetrics({
      ...VALID,
      amplitude: [{ t_ms: 0, rms: 0.02 }, { t_ms: 'x', rms: 1 }, null, { rms: 1 }],
      pitch: [
        { t_ms: 0, hz: Number.NaN },
        { t_ms: 10, hz: 90 },
      ],
    })
    expect(parsed?.amplitude).toEqual([{ t_ms: 0, rms: 0.02 }])
    expect(parsed?.pitch).toEqual([{ t_ms: 10, hz: 90 }])
  })

  it('caps how many samples can be stored', () => {
    const many = Array.from({ length: 9000 }, (_value, index) => ({ t_ms: index * 50, rms: 0.1 }))
    const parsed = parseCaptureMetrics({ ...VALID, amplitude: many })
    expect(parsed?.amplitude.length).toBe(4000)
  })

  it('defaults the sample interval when it is absent', () => {
    const { sample_interval_ms: _omitted, ...rest } = VALID
    expect(parseCaptureMetrics(rest)?.sample_interval_ms).toBe(50)
  })

  it.each([
    ['a non object', 'nope'],
    ['a missing mime type', { ...VALID, mime_type: undefined }],
    ['a missing start time', { ...VALID, started_at: 42 }],
    ['a missing duration', { ...VALID, duration_ms: null }],
    ['a negative duration', { ...VALID, duration_ms: -1 }],
    ['an implausible duration', { ...VALID, duration_ms: 10 * 60_000 }],
  ])('rejects %s', (_label, payload) => {
    expect(parseCaptureMetrics(payload)).toBeNull()
  })
})
