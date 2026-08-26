import type { TranscriptWord } from '@/lib/deepgram/parse'

export interface AmplitudeSample {
  t_ms: number
  rms: number
}

export interface PitchSample {
  t_ms: number
  hz: number
}

/**
 * Raw capture data, stored under `metrics.capture`. Nothing here is derived.
 * Prompt 3 computes its delivery measurements from these timelines and writes
 * them alongside, so this shape stays as close to what the microphone gave us
 * as possible.
 */
export interface CaptureMetrics {
  mime_type: string
  started_at: string
  duration_ms: number
  sample_interval_ms: number
  amplitude: AmplitudeSample[]
  /** Voiced frames only. Unvoiced and out of range frames are absent, not zero. */
  pitch: PitchSample[]
}

export interface TranscriptMetrics {
  provider: 'deepgram'
  model: string
  confidence: number | null
  words: TranscriptWord[]
}

/** Everything the mechanical half computed, stored beside the raw capture. */
export interface DeliveryBlock {
  metrics: unknown
  statistics: unknown
  pauses: unknown
  warnings: string[]
  scored_at: string
  version: number
}

export interface AttemptMetrics {
  capture?: CaptureMetrics
  transcript?: TranscriptMetrics
  delivery?: DeliveryBlock
  practice?: { additional_context?: string }
}
