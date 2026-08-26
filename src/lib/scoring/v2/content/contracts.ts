import type { PracticeMode } from '@/lib/practice/contracts'

export const V2_CONTENT_DETECTOR_VERSION = 'v2.content-detector.1' as const

export type V2ContentCategory = 'structure' | 'grammar' | 'vocabulary'
export type V2FindingSeverity = 'minor' | 'clear'
export type V2ContentStatus = 'checked' | 'not_checked'

export interface TranscriptEvidenceSpan {
  /** Zero-based character offset into the punctuated transcript string. */
  start: number
  /** Exclusive zero-based character offset into the punctuated transcript string. */
  end: number
  /** Optional recognized-word confidence, bounded inclusively from 0 through 1. */
  confidence?: number
}

export interface MechanicallyCountedSpan extends TranscriptEvidenceSpan {
  text: string
  category: 'filler' | 'false_start' | 'closer'
}

export interface V2ContentDetectorRequest {
  version: typeof V2_CONTENT_DETECTOR_VERSION
  mode: PracticeMode
  prompt: string
  transcript: string
  timeoutMs?: number
}

/** Provider-neutral text completion seam. Adapters own vendor request details. */
export interface V2ContentDetectorProvider {
  readonly name: string
  complete(request: V2ContentDetectorRequest): Promise<string>
}

export interface V2ContentFinding {
  kind: string
  severity: V2FindingSeverity
  quote: string | null
  observation: string
  suggestion: string | null
  evidence: TranscriptEvidenceSpan[]
  deduction: number
}

export interface V2CategoryResult {
  category: V2ContentCategory
  status: V2ContentStatus
  component: number | null
  findings: V2ContentFinding[]
  measurements: Record<string, number | boolean>
  warnings: string[]
}

export interface V2ContentEvaluation {
  version: typeof V2_CONTENT_DETECTOR_VERSION
  provider: string | null
  status: V2ContentStatus
  categories: Record<V2ContentCategory, V2CategoryResult>
  warnings: string[]
  calls: number
}

export interface V2ContentEvaluationInput {
  provider: V2ContentDetectorProvider
  mode: PracticeMode
  prompt: string
  transcript: string
  /** Character spans already charged by mechanical filler, false-start, or closer checks. */
  mechanicallyCounted?: readonly MechanicallyCountedSpan[]
  /** Character spans derived from recognized words that are unreliable for language findings. */
  unreliableTranscriptSpans?: readonly TranscriptEvidenceSpan[]
  timeoutMs?: number
}
