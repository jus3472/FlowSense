import { describe, expect, it } from 'vitest'
import { analyseClarity } from '@/lib/scoring/v2/clarity'
import type { CaptureMetrics } from '@/lib/types/metrics'

const capture: CaptureMetrics = { mime_type: 'audio/webm', started_at: '2026-01-01T00:00:00Z', duration_ms: 1000, sample_interval_ms: 100, amplitude: [{ t_ms: 0, rms: .01 }, { t_ms: 500, rms: .02 }, { t_ms: 900, rms: .01 }], pitch: [] }
const words = (values: number[]) => values.map((confidence, index) => ({ word: `word${index}`, start: index, end: index + .5, confidence }))

describe('clarity evidence', () => {
  it('scores supported clear and scattered recognition with bounded evidence', () => {
    expect(analyseClarity(words([.9,.9,.9,.9,.9,.9,.9,.9]), capture).component).toBe(1)
    const result = analyseClarity(words([.4,.9,.9,.9,.9,.9,.9,.9]), capture)
    expect(result.component).toBe(.875)
    expect(result.evidence[0]).toMatchObject({ source: 'transcript', start: 0, end: .5, quote: 'word0' })
  })
  it('withholds globally poor, empty, legacy, and unusable capture evidence', () => {
    expect(analyseClarity(words([.2,.2,.2,.2,.2,.2,.2,.9]), capture).status).toBe('not_checked')
    expect(analyseClarity(words([.9,.9]), capture).status).toBe('not_checked')
    expect(analyseClarity(words([.9,.9,.9,.9,.9,.9,.9,.9]), { ...capture, amplitude: [{ t_ms: 0, rms: 0 }] }).status).toBe('unavailable')
  })
})
