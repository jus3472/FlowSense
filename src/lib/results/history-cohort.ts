import type { PracticeMode } from '@/lib/practice/contracts'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'

export type HistoryResultKind = 'legacy' | 'v2' | 'partial' | 'unsupported'

export type HistoryScoreCohort =
  | { kind: 'legacy'; mode: PracticeMode | null }
  | {
      kind: 'v2'
      scoreVersion: string
      rubricVersion: string
      mode: PracticeMode
    }

export interface HistoryScoreInput {
  id: string
  createdAt: string
  score: number | null
  sectionScores: unknown
  practiceMode: PracticeMode | null
}

export interface HistoryScorePoint {
  attemptId: string
  createdAt: string
  value: number
}

export interface HistoryScoreSummary {
  cohort: HistoryScoreCohort | null
  points: readonly HistoryScorePoint[]
  average: number | null
  scannedCount: number
  excludedCount: number
  scanLimit: number
  truncated: boolean
}

export interface HistoryStoredResult {
  kind: HistoryResultKind
  score: number | null
}

interface ScoredCandidate extends HistoryScorePoint {
  cohort: HistoryScoreCohort
  time: number
}

function finiteScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

/** Uses only validated stored snapshots. Unsupported shapes remain visible but never comparable. */
export function readHistoryStoredResult(
  sectionScores: unknown,
  score: number | null,
): HistoryStoredResult {
  const snapshot = decodeStoredSectionSnapshot(sectionScores)
  if (snapshot.kind === 'unsupported_version') return { kind: 'unsupported', score: null }
  if (snapshot.kind === 'v2') {
    return finiteScore(snapshot.payload.total_earned_points)
      ? { kind: 'v2', score: snapshot.payload.total_earned_points }
      : { kind: 'partial', score: null }
  }
  if (snapshot.kind === 'legacy' && finiteScore(score)) return { kind: 'legacy', score }
  return { kind: 'partial', score: null }
}

function scoredCandidate(input: HistoryScoreInput): ScoredCandidate | null {
  const time = Date.parse(input.createdAt)
  if (!Number.isFinite(time)) return null
  const snapshot = decodeStoredSectionSnapshot(input.sectionScores)
  if (
    snapshot.kind === 'v2' &&
    input.practiceMode === snapshot.payload.mode &&
    finiteScore(snapshot.payload.total_earned_points)
  ) {
    return {
      attemptId: input.id,
      createdAt: input.createdAt,
      value: snapshot.payload.total_earned_points,
      time,
      cohort: {
        kind: 'v2',
        scoreVersion: snapshot.payload.version,
        rubricVersion: snapshot.payload.rubric_version,
        mode: snapshot.payload.mode,
      },
    }
  }
  if (snapshot.kind === 'legacy' && finiteScore(input.score)) {
    return {
      attemptId: input.id,
      createdAt: input.createdAt,
      value: input.score,
      time,
      cohort: { kind: 'legacy', mode: input.practiceMode },
    }
  }
  return null
}

function cohortKey(cohort: HistoryScoreCohort): string {
  return cohort.kind === 'legacy'
    ? JSON.stringify(['legacy', cohort.mode])
    : JSON.stringify([cohort.kind, cohort.scoreVersion, cohort.rubricVersion, cohort.mode])
}

/**
 * Selects the newest validated scored cohort, then keeps only exact compatible
 * members. Inputs are independently sorted so database tie ordering cannot
 * change the selection.
 */
export function summarizeHistoryScoreCohort(
  input: readonly HistoryScoreInput[],
  options: { scanLimit: number; truncated: boolean },
): HistoryScoreSummary {
  const candidates = input.flatMap((item) => {
    const candidate = scoredCandidate(item)
    return candidate ? [candidate] : []
  })
  candidates.sort(
    (left, right) => right.time - left.time || right.attemptId.localeCompare(left.attemptId),
  )
  const cohort = candidates[0]?.cohort ?? null
  const selectedKey = cohort ? cohortKey(cohort) : null
  const selected = selectedKey
    ? candidates.filter((candidate) => cohortKey(candidate.cohort) === selectedKey)
    : []
  const points = selected
    .sort((left, right) => left.time - right.time || left.attemptId.localeCompare(right.attemptId))
    .map(({ attemptId, createdAt, value }) => ({ attemptId, createdAt, value }))
  return {
    cohort,
    points,
    average:
      points.length === 0
        ? null
        : points.reduce((total, point) => total + point.value, 0) / points.length,
    scannedCount: input.length,
    excludedCount: input.length - points.length,
    scanLimit: options.scanLimit,
    truncated: options.truncated,
  }
}
