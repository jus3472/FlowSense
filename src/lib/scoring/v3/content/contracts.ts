import type { PracticeMode } from '@/lib/practice/contracts'
import type {
  V3MetricDetail,
  V3MetricEvaluation,
  WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'

export const V3_CONTENT_EVALUATOR_VERSION = 'v3.content-evaluator.1' as const
export const V3_CONTENT_AUDIT_VERSION = 'v3.content-audit.1' as const

/** Deterministic v3 Conciseness ownership is limited to structural restarts. */
export type MechanicalConcisenessKind = 'false_start'

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
  /** Bounded validator guidance included only on the single retry. */
  retryInstruction?: string
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
  /** Bounded development metadata. Never render this as user-facing copy. */
  diagnostic?: V3ContentFailureDiagnostic | null
}

/** Minimal provider metadata retained outside the authoritative score snapshot. */
export interface V3ContentAuditResult {
  version: typeof V3_CONTENT_AUDIT_VERSION
  evaluator_version: typeof V3_CONTENT_EVALUATOR_VERSION
  provider: 'deepseek'
  model: string
  status: V3ContentEvaluation['status']
  calls: number
  diagnostic?: V3ContentFailureDiagnostic
}

export function v3ContentAuditResult(
  evaluation: V3ContentEvaluation,
  model: string,
): V3ContentAuditResult {
  return {
    version: V3_CONTENT_AUDIT_VERSION,
    evaluator_version: evaluation.version,
    provider: 'deepseek',
    model,
    status: evaluation.status,
    calls: evaluation.calls,
    ...(evaluation.diagnostic ? { diagnostic: evaluation.diagnostic } : {}),
  }
}

export type V3ContentFailureCategory =
  | 'input_invalid'
  | 'provider_unavailable'
  | 'provider_invalid_response'
  | 'content_validation_failed'
  | 'internal_error'

export interface V3ContentFailureDiagnostic {
  category: V3ContentFailureCategory
  code: string
  reason: string | null
  metric: WhatYouSaidMetricId | null
}

export interface V3ContentEvaluationInput {
  provider: V3ContentEvaluatorProvider
  mode: PracticeMode
  prompt: string
  transcript: string
  mechanicallyOwned?: readonly V3MechanicallyOwnedSpan[]
  unreliableTranscriptSpans?: readonly V3TranscriptSpan[]
  timeoutMs?: number
  /** Safe correlation id for bounded server diagnostics. */
  diagnosticAttemptId?: string
}
