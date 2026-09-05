import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'

export type HistoryResultKind = 'current' | 'partial' | 'unsupported'

export interface HistoryStoredResult {
  kind: HistoryResultKind
  score: number | null
}

function finiteScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

/** Uses only validated stored snapshots. Unsupported shapes remain visible but never comparable. */
export function readHistoryStoredResult(
  sectionScores: unknown,
  _score: number | null,
): HistoryStoredResult {
  const snapshot = decodeStoredSectionSnapshot(sectionScores)
  if (snapshot.kind === 'unsupported_version') return { kind: 'unsupported', score: null }
  if (snapshot.kind === 'v3') {
    return finiteScore(snapshot.payload.total_earned_points)
      ? { kind: 'current', score: snapshot.payload.total_earned_points }
      : { kind: 'partial', score: null }
  }
  return { kind: 'partial', score: null }
}
