import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifySpeakingActivity, isSpeakingActivity } from '@/lib/activity/speaking'
import { computeActivityStreak, type ActivityStreak } from '@/lib/streak'
import { localDateKey, safeTimezone } from '@/lib/timezone'
import type { Database } from '@/lib/types/database'

const ACTIVITY_PAGE_SIZE = 366

export interface PracticeActivityAttempt {
  status: unknown
  durationMs: unknown
  transcript: unknown
  score: unknown
  sectionScores: unknown
}

export interface PracticeActivitySummary extends ActivityStreak {
  timezone: string
  today: string
  dailyGoal: 'complete' | 'incomplete'
}

export type RecordPracticeActivityOutcome =
  | { status: 'recorded'; localDate: string; timezone: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failure' }

export type PracticeActivityLoadOutcome =
  | { status: 'ready'; data: PracticeActivitySummary }
  | { status: 'failure'; reason: 'query' | 'invalid_response' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'unknown'
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : 'unknown'
}

function logActivityFailure(operation: string, error?: unknown): void {
  console.error('[activity] operation failed', {
    operation,
    code: safeCode(error),
  })
}

async function readTimezone(client: SupabaseClient<Database>, userId: string): Promise<string> {
  try {
    const { data, error } = await client
      .from('profiles')
      .select('timezone')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      logActivityFailure('load_timezone', error)
      return safeTimezone(null)
    }
    return safeTimezone(data?.timezone)
  } catch (error) {
    logActivityFailure('load_timezone', error)
    return safeTimezone(null)
  }
}

/** Records at most one trusted activity row for a user's local completion day. */
export async function recordPracticeActivityDay(
  admin: SupabaseClient<Database>,
  userId: string,
  attempt: PracticeActivityAttempt,
  completedAt: Date = new Date(),
): Promise<RecordPracticeActivityOutcome> {
  const classification = classifySpeakingActivity(attempt)
  if (!isSpeakingActivity(classification)) {
    return { status: 'skipped', reason: classification.reason }
  }

  const timezone = await readTimezone(admin, userId)
  const localDate = localDateKey(completedAt, timezone)
  try {
    const { error } = await admin.from('practice_activity_days').upsert(
      {
        user_id: userId,
        local_date: localDate,
        timezone,
      },
      { onConflict: 'user_id,local_date', ignoreDuplicates: true },
    )
    if (error) {
      logActivityFailure('record_day', error)
      return { status: 'failure' }
    }
    return { status: 'recorded', localDate, timezone }
  } catch (error) {
    logActivityFailure('record_day', error)
    return { status: 'failure' }
  }
}

function parseActivityRows(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const dates: string[] = []
  for (const row of value) {
    if (!isRecord(row) || typeof row.local_date !== 'string') return null
    dates.push(row.local_date)
  }
  return dates
}

/** Loads durable days until the first streak gap, without projecting from attempts. */
export async function loadPracticeActivitySummary(
  client: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
): Promise<PracticeActivityLoadOutcome> {
  const timezone = await readTimezone(client, userId)
  const today = localDateKey(now, timezone)
  const dates: string[] = []

  try {
    for (let from = 0; ; from += ACTIVITY_PAGE_SIZE) {
      const { data, error } = await client
        .from('practice_activity_days')
        .select('local_date')
        .eq('user_id', userId)
        .lte('local_date', today)
        .order('local_date', { ascending: false })
        .range(from, from + ACTIVITY_PAGE_SIZE - 1)
      if (error) {
        logActivityFailure('load_days', error)
        return { status: 'failure', reason: 'query' }
      }
      const page = parseActivityRows(data)
      if (!page) {
        logActivityFailure('load_days')
        return { status: 'failure', reason: 'invalid_response' }
      }
      dates.push(...page)
      const streak = computeActivityStreak(dates, today)
      if (page.length < ACTIVITY_PAGE_SIZE || streak.current < dates.length) {
        return {
          status: 'ready',
          data: {
            ...streak,
            timezone,
            today,
            dailyGoal: streak.todayActive ? 'complete' : 'incomplete',
          },
        }
      }
    }
  } catch (error) {
    logActivityFailure('load_days', error)
    return { status: 'failure', reason: 'query' }
  }
}
