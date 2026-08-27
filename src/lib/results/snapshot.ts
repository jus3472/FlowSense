import { CHECK_NAMES } from '@/lib/scoring/content'
import { DELIVERY_POINTS } from '@/lib/scoring/mechanical'
import { isScorePayloadForDefinition, type V2ScorePayload } from '@/lib/scoring/v2/assemble'
import { scoringDefinitionFor } from '@/lib/scoring/v2/registry'

export interface LegacySectionSnapshot {
  content: {
    earned: number
    max: number
    checks: Record<(typeof CHECK_NAMES)[number], number>
  }
  delivery: {
    earned: number
    max: number
    metrics: Record<keyof typeof DELIVERY_POINTS, number>
  }
}

export type StoredSectionSnapshot =
  | { kind: 'none' }
  | { kind: 'legacy'; sections: LegacySectionSnapshot }
  | { kind: 'v2'; payload: V2ScorePayload }
  | {
      kind: 'unsupported_version'
      scoreVersion: string | null
      rubricVersion: string | null
    }
  | { kind: 'malformed' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value)
}

function isLegacySectionSnapshot(value: unknown): value is LegacySectionSnapshot {
  if (!isRecord(value) || !isRecord(value.content) || !isRecord(value.delivery)) return false
  const { content, delivery } = value
  const checks = content.checks
  const metrics = delivery.metrics
  if (!finiteNumber(content.earned) || !finiteNumber(content.max) || !isRecord(checks)) {
    return false
  }
  if (!finiteNumber(delivery.earned) || !finiteNumber(delivery.max) || !isRecord(metrics)) {
    return false
  }
  return (
    exactKeys(checks, CHECK_NAMES) &&
    CHECK_NAMES.every((name) => finiteNumber(checks[name])) &&
    exactKeys(metrics, Object.keys(DELIVERY_POINTS)) &&
    Object.values(metrics).every(finiteNumber)
  )
}

function hasVersionedShape(value: Record<string, unknown>): boolean {
  return [
    'version',
    'rubric_version',
    'mode',
    'total_earned_points',
    'total_max_points',
    'categories',
  ].some((key) => key in value)
}

/**
 * The only persisted section-score interpretation boundary. It accepts exact
 * supported versions, preserves legacy independently, and fails closed for
 * future or malformed versioned snapshots.
 */
export function decodeStoredSectionSnapshot(value: unknown): StoredSectionSnapshot {
  if (value === null) return { kind: 'none' }
  if (!isRecord(value)) return { kind: 'malformed' }

  if (hasVersionedShape(value)) {
    if (typeof value.version !== 'string' || typeof value.rubric_version !== 'string') {
      return { kind: 'malformed' }
    }
    const scoreVersion = value.version
    const rubricVersion = value.rubric_version
    const definition = scoringDefinitionFor(scoreVersion, rubricVersion)
    if (!definition) {
      return { kind: 'unsupported_version', scoreVersion, rubricVersion }
    }
    return isScorePayloadForDefinition(value, definition)
      ? { kind: 'v2', payload: value }
      : { kind: 'malformed' }
  }

  return isLegacySectionSnapshot(value)
    ? { kind: 'legacy', sections: value }
    : { kind: 'malformed' }
}
