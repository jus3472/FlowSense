import type { PracticeMode } from '@/lib/practice/contracts'
import type {
  V3MetricDetail,
  V3MetricEvaluation,
  WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'

export const V3_CONTENT_EVALUATOR_VERSION = 'v3.content-evaluator.1' as const

export type MechanicalConcisenessKind = 'filler' | 'false_start' | 'closer'

export interface V3TranscriptSpan {
  start: number
  end: number
  confidence?: number
}

export interface V3MechanicallyOwnedSpan extends V3TranscriptSpan {
  text: string
  category: MechanicalConcisenessKind
}

export interface V3ContentEvaluatorRequest {
  version: typeof V3_CONTENT_EVALUATOR_VERSION
  mode: PracticeMode
  prompt: string
  transcript: string
  mechanicallyOwned: readonly V3MechanicallyOwnedSpan[]
  unreliableTranscriptSpans: readonly V3TranscriptSpan[]
  timeoutMs?: number
}

export interface V3ContentEvaluatorProvider {
  readonly name: string
  complete(request: V3ContentEvaluatorRequest): Promise<string>
}

export interface V3ContentMetricResult extends Omit<
  V3MetricEvaluation,
  'metric' | 'status' | 'details'
> {
  metric: WhatYouSaidMetricId
  status: 'scored' | 'not_checked'
  details: readonly V3MetricDetail[]
}

export interface V3ContentEvaluation {
  version: typeof V3_CONTENT_EVALUATOR_VERSION
  provider: string | null
  status: 'checked' | 'not_checked'
  metrics: Readonly<Record<WhatYouSaidMetricId, V3ContentMetricResult>>
  warnings: readonly string[]
  calls: number
}

export interface V3ContentEvaluationInput {
  provider: V3ContentEvaluatorProvider
  mode: PracticeMode
  prompt: string
  transcript: string
  mechanicallyOwned?: readonly V3MechanicallyOwnedSpan[]
  unreliableTranscriptSpans?: readonly V3TranscriptSpan[]
  timeoutMs?: number
}
