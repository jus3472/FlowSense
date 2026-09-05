import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifySpeakingActivity, isSpeakingActivity } from '@/lib/activity/speaking'
import type { Database } from '@/lib/types/database'

export const RECENT_STRUCTURED_ATTEMPT_PAGE_SIZE = 100

export type RecentStructuredLessonOutcome =
  | { status: 'ready'; lessonId: string | null }
  | { status: 'failure'; reason: 'query' | 'invalid_response'; error?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeErrorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'unknown'
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : 'unknown'
}

export function logRecentStructuredLessonFailure(
  result: Extract<RecentStructuredLessonOutcome, { status: 'failure' }>,
): void {
  console.error('[home] recent structured lesson load failed', {
    reason: result.reason,
    code: safeErrorCode(result.error),
  })
}

/** Finds the newest completed structured response that qualifies as speaking activity. */
export async function loadRecentStructuredLessonId(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<RecentStructuredLessonOutcome> {
  for (let from = 0; ; from += RECENT_STRUCTURED_ATTEMPT_PAGE_SIZE) {
    try {
      const { data, error } = await supabase
        .from('attempts')
        .select('lesson_id, status, duration_ms, transcript, score, section_scores')
        .eq('user_id', userId)
        .eq('status', 'done')
        .not('lesson_id', 'is', null)
        .order('finished_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .range(from, from + RECENT_STRUCTURED_ATTEMPT_PAGE_SIZE - 1)

      if (error) return { status: 'failure', reason: 'query', error }
      if (!Array.isArray(data)) return { status: 'failure', reason: 'invalid_response' }

      for (const row of data) {
        if (!isRecord(row) || typeof row.lesson_id !== 'string') {
          return { status: 'failure', reason: 'invalid_response' }
        }
        if (
          isSpeakingActivity(
            classifySpeakingActivity({
              status: row.status,
              durationMs: row.duration_ms,
              transcript: row.transcript,
              score: row.score,
              sectionScores: row.section_scores,
            }),
          )
        ) {
          return { status: 'ready', lessonId: row.lesson_id }
        }
      }

      if (data.length < RECENT_STRUCTURED_ATTEMPT_PAGE_SIZE) {
        return { status: 'ready', lessonId: null }
      }
    } catch (error) {
      return { status: 'failure', reason: 'query', error }
    }
  }
}
