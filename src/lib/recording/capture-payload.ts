import { SAMPLE_INTERVAL_MS } from '@/lib/recording/audio-sampler'
import { MAX_RECORDING_MS } from '@/lib/recording/recorder'
import type { AmplitudeSample, CaptureMetrics, PitchSample } from '@/lib/types/metrics'

/** 60 seconds at 20 samples per second is 1200. The headroom absorbs timer drift. */
const MAX_SAMPLES = 4000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The capture timelines arrive from the browser and land in jsonb, so they are
 * rebuilt field by field here rather than trusted. Anything unexpected is
 * dropped instead of stored.
 */
export function parseCaptureMetrics(value: unknown): CaptureMetrics | null {
  if (!isRecord(value)) return null

  const mimeType = typeof value.mime_type === 'string' ? value.mime_type : null
  const startedAt = typeof value.started_at === 'string' ? value.started_at : null
  const durationMs = finiteNumber(value.duration_ms)
  if (!mimeType || !startedAt || durationMs === null) return null
  if (durationMs < 0 || durationMs > MAX_RECORDING_MS * 2) return null

  const amplitude: AmplitudeSample[] = []
  if (Array.isArray(value.amplitude)) {
    for (const entry of value.amplitude.slice(0, MAX_SAMPLES)) {
      if (!isRecord(entry)) continue
      const tMs = finiteNumber(entry.t_ms)
      const rms = finiteNumber(entry.rms)
      if (tMs === null || rms === null) continue
      amplitude.push({ t_ms: tMs, rms })
    }
  }

  const pitch: PitchSample[] = []
  if (Array.isArray(value.pitch)) {
    for (const entry of value.pitch.slice(0, MAX_SAMPLES)) {
      if (!isRecord(entry)) continue
      const tMs = finiteNumber(entry.t_ms)
      const hz = finiteNumber(entry.hz)
      if (tMs === null || hz === null) continue
      pitch.push({ t_ms: tMs, hz })
    }
  }

  return {
    mime_type: mimeType,
    started_at: startedAt,
    duration_ms: Math.round(durationMs),
    sample_interval_ms: finiteNumber(value.sample_interval_ms) ?? SAMPLE_INTERVAL_MS,
    amplitude,
    pitch,
  }
}
