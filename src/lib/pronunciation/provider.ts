import type {
  PronunciationAssessmentRequest,
  PronunciationEvaluation,
} from '@/lib/pronunciation/contracts'

/** Provider-neutral runtime seam. Implementations return evidence, never a score. */
export interface PronunciationProvider {
  id: string
  assess(
    request: PronunciationAssessmentRequest,
    audio: ArrayBuffer,
  ): Promise<PronunciationEvaluation>
}
