import type { StoredContentResult } from '@/lib/scoring/assemble'
import type { DeliveryMetricName, DeliveryStatistics, MetricResult } from '@/lib/scoring/mechanical'
import type { Pause } from '@/lib/scoring/pauses'
import type { CheckName } from '@/lib/scoring/content'
import type { TranscriptWord } from '@/lib/deepgram/parse'

/** What the results view needs, already narrowed out of the jsonb columns. */
export interface AttemptView {
  id: string
  promptText: string
  transcript: string
  durationMs: number
  createdAt: string
  audioUrl: string | null
  score: number
  sections: {
    content: { earned: number; max: number; checks: Record<CheckName, number> }
    delivery: { earned: number; max: number; metrics: Record<DeliveryMetricName, number> }
  }
  metrics: Record<DeliveryMetricName, MetricResult>
  statistics: DeliveryStatistics
  pauses: Pause[]
  words: TranscriptWord[]
  content: StoredContentResult
}
