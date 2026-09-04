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
 * v3 computes its audio measurements from these timelines. Intermediate audio
 * diagnostics stay transient, so this shape stays close to the microphone data
 * needed to reproduce and audit the result.
 */
export interface CaptureMetrics {
  mime_type: string
  /** Historical captures may contain this unused timestamp; new captures omit it. */
  started_at?: string
  duration_ms: number
  sample_interval_ms: number
  amplitude: AmplitudeSample[]
  /** Voiced frames only. Unvoiced and out of range frames are absent, not zero. */
  pitch: PitchSample[]
}

export interface TranscriptMetrics {
  provider: 'deepgram'
  model: string
  /** Historical successful transcripts may contain this unused aggregate value. */
  confidence?: number | null
  words: TranscriptWord[]
  /** Historical successful transcripts may contain the provider-reported duration. */
  duration_seconds?: number | null
  /** Persisted only when Deepgram reports a degraded or unavailable result. */
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
