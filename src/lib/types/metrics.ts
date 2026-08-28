import type {
  DeepgramTranscriptQuality,
  DeepgramUnavailableQuality,
  TranscriptWord,
} from '@/lib/deepgram/parse'
import type { PronunciationEvaluation } from '@/lib/pronunciation/contracts'
import type { ChapterLevel, PathSlug } from '@/lib/curriculum/contracts'

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
  duration_seconds?: number | null
  quality?: DeepgramTranscriptQuality | DeepgramUnavailableQuality
}

export interface AttemptUploadMetrics {
  storage_path: string
  mime_type: string
}

export interface AttemptCreationMetrics {
  prompt_id: string | null
  retry_of_attempt_id: string | null
  curriculum?: {
    lesson_id: string
    path_slug: PathSlug
    chapter_level: ChapterLevel
    lesson_slug: string
    lesson_position: number
    checkpoint: boolean
  }
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
  practice?: { target_duration_seconds?: number; additional_context?: string }
  creation?: AttemptCreationMetrics
  upload?: AttemptUploadMetrics
  pronunciation?: PronunciationEvaluation
}
