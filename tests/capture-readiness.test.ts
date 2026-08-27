import { describe, expect, it } from 'vitest'
import {
  MIN_PROCESSABLE_RECORDING_MS,
  assessCaptureReadiness,
} from '@/lib/recording/capture-readiness'
import type { AttemptRecording } from '@/lib/recording/recorder'

function recording(
  overrides: Partial<AttemptRecording> & { blobText?: string } = {},
): AttemptRecording {
  const durationMs = overrides.durationMs ?? 1_000
  const amplitude = Array.from({ length: Math.floor(durationMs / 50) + 1 }, (_, index) => ({
    t_ms: Math.min(durationMs, index * 50),
    rms: index % 2 === 0 ? 0.001 : 0.0015,
  }))
  return {
    blob: overrides.blob ?? new Blob([overrides.blobText ?? 'recorded-audio']),
    mimeType: overrides.mimeType ?? 'audio/webm;codecs=opus',
    durationMs,
    startedAt: overrides.startedAt ?? '2026-08-27T12:00:00.000Z',
    amplitude: overrides.amplitude ?? amplitude,
    pitch: overrides.pitch ?? [],
  }
}

describe('assessCaptureReadiness', () => {
  it('rejects an immediate stop before any upload or provider work', () => {
    expect(assessCaptureReadiness(recording({ durationMs: 20 }))).toMatchObject({
      ok: false,
      reason: 'too_short',
    })
    expect(MIN_PROCESSABLE_RECORDING_MS).toBe(750)
  })

  it('rejects an empty recorder blob even after enough time', () => {
    expect(assessCaptureReadiness(recording({ blob: new Blob([]) }))).toMatchObject({
      ok: false,
      reason: 'empty_audio',
    })
  })

  it('rejects a dense, full-length timeline containing only silence', () => {
    const amplitude = Array.from({ length: 21 }, (_, index) => ({
      t_ms: index * 50,
      rms: 0,
    }))
    expect(assessCaptureReadiness(recording({ amplitude }))).toMatchObject({
      ok: false,
      reason: 'no_speech',
    })
  })

  it('accepts valid quiet speech based on relative variation, not loudness', () => {
    const amplitude = Array.from({ length: 21 }, (_, index) => ({
      t_ms: index * 50,
      rms: index % 3 === 0 ? 0.00002 : 0.00004,
    }))
    expect(assessCaptureReadiness(recording({ amplitude }))).toEqual({ ok: true })
  })

  it('accepts voiced frames even when amplitude is steady', () => {
    const amplitude = Array.from({ length: 21 }, (_, index) => ({
      t_ms: index * 50,
      rms: 0.0001,
    }))
    expect(
      assessCaptureReadiness(recording({ amplitude, pitch: [{ t_ms: 500, hz: 145.2 }] })),
    ).toEqual({ ok: true })
  })

  it('does not reject sparse or background-throttled sampling as silence', () => {
    expect(
      assessCaptureReadiness(
        recording({
          durationMs: 5_000,
          amplitude: [
            { t_ms: 0, rms: 0 },
            { t_ms: 150, rms: 0 },
          ],
        }),
      ),
    ).toEqual({ ok: true })
  })
})
