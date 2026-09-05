import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifySpeakingActivity } from '@/lib/activity/speaking'
import { readAttemptResult } from '@/lib/results/attempt-result'
import type { Database } from '@/lib/types/database'

const LESSON_ATTEMPT_COLUMNS =
  'id, prompt_text, transcript, duration_ms, created_at, finished_at, score, section_scores, metrics, content_result, status'
export const LESSON_ATTEMPT_HISTORY_PAGE_SIZE = 100

export interface LessonAttemptHistoryItem {
  attemptId: string
  score: number | null
  finishedAt: string
}

export type LessonAttemptHistoryOutcome =
  | { status: 'ready'; data: readonly LessonAttemptHistoryItem[] }
  | { status: 'failure'; error: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function validStoredTime(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function historyItem(value: unknown, currentAttemptId: string): LessonAttemptHistoryItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id === currentAttemptId ||
    typeof value.prompt_text !== 'string' ||
    (value.transcript !== null && typeof value.transcript !== 'string') ||
    (value.duration_ms !== null &&
      (typeof value.duration_ms !== 'number' || !Number.isFinite(value.duration_ms))) ||
    !finiteNumberOrNull(value.score)
  ) {
    return null
  }

  const finishedAt = validStoredTime(value.finished_at) ?? validStoredTime(value.created_at)
  if (finishedAt === null) return null

  const activity = classifySpeakingActivity({
    status: value.status,
    durationMs: value.duration_ms,
    transcript: value.transcript,
    score: value.score,
    sectionScores: value.section_scores,
  })
  if (activity.kind === 'invalid') return null

  const result = readAttemptResult({
    id: value.id,
    promptText: value.prompt_text,
    transcript: value.transcript,
    durationMs: value.duration_ms,
    createdAt: finishedAt,
    audioUrl: null,
    score: value.score,
    sectionScores: value.section_scores,
    metrics: value.metrics,
    contentResult: value.content_result,
  })
  if (result.kind !== 'v3') return null

  return {
    attemptId: value.id,
    score: activity.score,
    finishedAt,
  }
}

/**
 * Loads every other viewable, completed result for one owned structured lesson.
 * Result snapshots are decoded but never recalculated or converted.
 */
export async function loadLessonAttemptHistoryForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  lessonId: string,
  currentAttemptId: string,
): Promise<LessonAttemptHistoryOutcome> {
  try {
    const rows: unknown[] = []
    for (let from = 0; ; from += LESSON_ATTEMPT_HISTORY_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('attempts')
        .select(LESSON_ATTEMPT_COLUMNS)
        .eq('user_id', userId)
        .eq('lesson_id', lessonId)
        .eq('status', 'done')
        .neq('id', currentAttemptId)
        .order('finished_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + LESSON_ATTEMPT_HISTORY_PAGE_SIZE - 1)

      if (error || !Array.isArray(data)) {
        return { status: 'failure', error: error ?? { code: 'INVALID_RESPONSE' } }
      }
      rows.push(...data)
      if (data.length < LESSON_ATTEMPT_HISTORY_PAGE_SIZE) break
    }

    const items = rows
      .map((row) => historyItem(row, currentAttemptId))
      .filter((item): item is LessonAttemptHistoryItem => item !== null)
      .sort(
        (left, right) =>
          Date.parse(right.finishedAt) - Date.parse(left.finishedAt) ||
          right.attemptId.localeCompare(left.attemptId),
      )

    return { status: 'ready', data: items }
  } catch (error) {
    return { status: 'failure', error }
  }
}
