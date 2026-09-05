import { isV3ScorePayload } from '@/lib/scoring/v3/assemble'
import {
  V3_RUBRIC_VERSION,
  V3_SCORE_PAYLOAD_VERSION,
  type V3ScorePayload,
} from '@/lib/scoring/v3/contracts'

export type StoredSectionSnapshot =
  | { kind: 'none' }
  | { kind: 'v3'; payload: V3ScorePayload }
  | {
      kind: 'unsupported_version'
      scoreVersion: string | null
      rubricVersion: string | null
    }
  | { kind: 'malformed' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasVersionedShape(value: Record<string, unknown>): boolean {
  return [
    'version',
    'rubric_version',
    'mode',
    'total_earned_points',
    'total_max_points',
    'sections',
  ].some((key) => key in value)
}

/**
 * The only persisted section-score interpretation boundary. It accepts the
 * exact current version and fails closed for older, future, or malformed data.
 */
export function decodeStoredSectionSnapshot(value: unknown): StoredSectionSnapshot {
  if (value === null) return { kind: 'none' }
  if (!isRecord(value) || !hasVersionedShape(value)) return { kind: 'malformed' }
  if (typeof value.version !== 'string' || typeof value.rubric_version !== 'string') {
    return { kind: 'malformed' }
  }
  const scoreVersion = value.version
  const rubricVersion = value.rubric_version
  if (scoreVersion !== V3_SCORE_PAYLOAD_VERSION || rubricVersion !== V3_RUBRIC_VERSION) {
    return { kind: 'unsupported_version', scoreVersion, rubricVersion }
  }
  return isV3ScorePayload(value) ? { kind: 'v3', payload: value } : { kind: 'malformed' }
}
