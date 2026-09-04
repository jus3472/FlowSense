import { parseCurriculumScore } from '@/lib/curriculum/thresholds'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'
import { isV3ScorePayload } from '@/lib/scoring/v3/assemble'

export interface SpeakingActivityInput {
  status: unknown
  durationMs: unknown
  transcript: unknown
  score: unknown
  sectionScores: unknown
}

export type SpeakingActivityInvalidReason =
  | 'not_done'
  | 'invalid_duration'
  | 'empty_transcript'
  | 'missing_result'
  | 'malformed_result'
  | 'unsupported_result'
  | 'score_mismatch'

export type SpeakingActivityClassification =
  | { kind: 'scored'; score: number; resultKind: 'v3' | 'v2' | 'legacy' }
  | { kind: 'neutral'; score: null; resultKind: 'v3' | 'v2' }
  | { kind: 'invalid'; reason: SpeakingActivityInvalidReason }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Classifies one stored response for future activity ledgers. Activity is
 * independent from curriculum passing, so every valid numeric score qualifies.
 */
export function classifySpeakingActivity(
  input: SpeakingActivityInput,
): SpeakingActivityClassification {
  if (input.status !== 'done') return { kind: 'invalid', reason: 'not_done' }
  if (
    typeof input.durationMs !== 'number' ||
    !Number.isFinite(input.durationMs) ||
    input.durationMs <= 0
  ) {
    return { kind: 'invalid', reason: 'invalid_duration' }
  }
  if (typeof input.transcript !== 'string' || input.transcript.trim().length === 0) {
    return { kind: 'invalid', reason: 'empty_transcript' }
  }

  if (isV3ScorePayload(input.sectionScores)) {
    const total = input.sectionScores.total_earned_points
    if (total === null) {
      return input.score === null
        ? { kind: 'neutral', score: null, resultKind: 'v3' }
        : { kind: 'invalid', reason: 'score_mismatch' }
    }
    const score = parseCurriculumScore(input.score)
    return score !== null && score === total
      ? { kind: 'scored', score, resultKind: 'v3' }
      : { kind: 'invalid', reason: 'score_mismatch' }
  }
  if (isRecord(input.sectionScores) && input.sectionScores.version === 'v3.score.1') {
    return { kind: 'invalid', reason: 'malformed_result' }
  }

  const snapshot = decodeStoredSectionSnapshot(input.sectionScores)
  if (snapshot.kind === 'none') return { kind: 'invalid', reason: 'missing_result' }
  if (snapshot.kind === 'malformed') return { kind: 'invalid', reason: 'malformed_result' }
  if (snapshot.kind === 'unsupported_version') {
    return { kind: 'invalid', reason: 'unsupported_result' }
  }

  if (snapshot.kind === 'legacy') {
    const score = parseCurriculumScore(input.score)
    return score === null
      ? { kind: 'invalid', reason: 'score_mismatch' }
      : { kind: 'scored', score, resultKind: 'legacy' }
  }

  const total = snapshot.payload.total_earned_points
  if (total === null) {
    return input.score === null
      ? { kind: 'neutral', score: null, resultKind: 'v2' }
      : { kind: 'invalid', reason: 'score_mismatch' }
  }

  const score = parseCurriculumScore(input.score)
  return score !== null && score === total
    ? { kind: 'scored', score, resultKind: 'v2' }
    : { kind: 'invalid', reason: 'score_mismatch' }
}

export function isSpeakingActivity(
  classification: SpeakingActivityClassification,
): classification is Exclude<SpeakingActivityClassification, { kind: 'invalid' }> {
  return classification.kind !== 'invalid'
}
