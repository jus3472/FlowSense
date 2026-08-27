import { recentCompletedLibraryPromptIds } from '@/lib/prompts/selection'
import { readAttemptResult } from '@/lib/results/attempt-result'
import { largestDeduction, summariseAttempt } from '@/lib/results/summary'
import { v2OverallTakeaway } from '@/lib/results/v2'
import { CONTENT_POINTS } from '@/lib/scoring/content'

export interface HomeLatestResponse {
  attemptId: string
  score: number | null
  summary: string | null
}

export interface HomeResponseData {
  latest: HomeLatestResponse | null
  latestUnavailable: boolean
  recentPromptIds: string[]
  scores: number[]
  timestamps: string[]
}

interface HomeCompletedAttemptRow {
  id: string
  prompt_id: string | null
  prompt_text: string
  prompt_source: 'library' | 'custom' | null
  transcript: string | null
  duration_ms: number | null
  created_at: string
  score: number | null
  section_scores: unknown
  metrics: unknown
  content_result: unknown
  status: 'done'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function validStoredOverallScore(value: number | null): value is number {
  return value !== null && value >= 0 && value <= 100
}

function parseCompletedAttempt(value: unknown): HomeCompletedAttemptRow | null {
  if (!isRecord(value)) return null

  const createdAt = typeof value.created_at === 'string' ? value.created_at : ''
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    (value.prompt_id !== null && typeof value.prompt_id !== 'string') ||
    typeof value.prompt_text !== 'string' ||
    (value.prompt_source !== null &&
      value.prompt_source !== 'library' &&
      value.prompt_source !== 'custom') ||
    (value.transcript !== null && typeof value.transcript !== 'string') ||
    !finiteNumberOrNull(value.duration_ms) ||
    !finiteNumberOrNull(value.score) ||
    createdAt.length === 0 ||
    Number.isNaN(Date.parse(createdAt)) ||
    value.status !== 'done'
  ) {
    return null
  }

  return {
    id: value.id,
    prompt_id: value.prompt_id,
    prompt_text: value.prompt_text,
    prompt_source: value.prompt_source,
    transcript: value.transcript,
    duration_ms: value.duration_ms,
    created_at: createdAt,
    score: value.score,
    section_scores: value.section_scores,
    metrics: value.metrics,
    content_result: value.content_result,
    status: 'done',
  }
}

function compareNewestFirst(left: HomeCompletedAttemptRow, right: HomeCompletedAttemptRow): number {
  const createdAtOrder = right.created_at.localeCompare(left.created_at)
  return createdAtOrder !== 0 ? createdAtOrder : right.id.localeCompare(left.id)
}

interface ReadHomeResult {
  latest: HomeLatestResponse | null
  trendCohort: string | null
}

function readHomeResult(attempt: HomeCompletedAttemptRow): ReadHomeResult {
  const result = readAttemptResult({
    id: attempt.id,
    promptText: attempt.prompt_text,
    transcript: attempt.transcript,
    durationMs: attempt.duration_ms,
    createdAt: attempt.created_at,
    audioUrl: null,
    score: attempt.score,
    sectionScores: attempt.section_scores,
    metrics: attempt.metrics,
    contentResult: attempt.content_result,
  })

  if (result.kind === 'v2') {
    return {
      latest: {
        attemptId: attempt.id,
        score: result.payload.total_earned_points,
        summary: v2OverallTakeaway(result.payload),
      },
      trendCohort: `v2:${result.payload.version}:${result.payload.rubric_version}`,
    }
  }
  if (result.kind === 'legacy') {
    return {
      latest: {
        attemptId: attempt.id,
        score: result.attempt.score,
        summary: summariseAttempt(
          result.attempt.score,
          largestDeduction(
            result.attempt.metrics,
            result.attempt.sections.content.checks,
            CONTENT_POINTS,
          ),
        ),
      },
      trendCohort: 'legacy',
    }
  }

  // Lifecycle backfill marked historical score-only rows done. Their stored
  // overall remains authoritative even when no supported detail snapshot can
  // be decoded. Keep the owned link and number, but do not invent a summary or
  // connect that number to a scoring cohort.
  if (validStoredOverallScore(attempt.score)) {
    return {
      latest: { attemptId: attempt.id, score: attempt.score, summary: null },
      trendCohort: null,
    }
  }
  return { latest: null, trendCohort: null }
}

/**
 * Builds every response-derived Home value from one newest-first snapshot.
 * Stored snapshots are interpreted at the shared result boundary and are never
 * recalculated. An undecodable latest row keeps only a validated standalone
 * overall; without one it is unavailable rather than replaced by an older row.
 */
export function buildHomeResponseData(rows: unknown): HomeResponseData | null {
  if (!Array.isArray(rows)) return null

  const attempts: HomeCompletedAttemptRow[] = []
  for (const row of rows) {
    const attempt = parseCompletedAttempt(row)
    if (!attempt) return null
    attempts.push(attempt)
  }
  attempts.sort(compareNewestFirst)

  const newest = attempts[0] ?? null
  const results = attempts.map(readHomeResult)
  const latestResult = results[0] ?? null
  const latest = latestResult?.latest ?? null
  const trendCohort = latestResult?.trendCohort ?? null
  const scores = results
    .flatMap((result) => {
      const score = result.latest?.score
      return trendCohort !== null &&
        result.trendCohort === trendCohort &&
        score !== null &&
        score !== undefined
        ? [score]
        : []
    })
    .reverse()

  return {
    latest,
    latestUnavailable: newest !== null && latest === null,
    recentPromptIds: recentCompletedLibraryPromptIds(attempts),
    scores,
    timestamps: attempts.map((attempt) => attempt.created_at),
  }
}
