import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildHomeResponseData, type HomeResponseData } from '@/lib/home/responses'
import type { Database } from '@/lib/types/database'

export const HOME_COMPLETED_ATTEMPT_LIMIT = 30

const HOME_ATTEMPT_COLUMNS =
  'id, prompt_id, prompt_text, prompt_source, transcript, duration_ms, created_at, score, section_scores, metrics, content_result, status'

export type HomeResponseLoadResult =
  | { status: 'ready'; data: HomeResponseData }
  | { status: 'failure'; reason: 'query' | 'invalid_response' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function safeHomeDiagnosticCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'unknown'
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : 'unknown'
}

export function logHomeDataFailure(operation: string, reason: string, error?: unknown): void {
  console.error('[home] data load failed', {
    operation,
    reason,
    code: safeHomeDiagnosticCode(error),
  })
}

/** Loads the bounded, owned attempt snapshot used by every response-derived Home section. */
export async function loadHomeResponseData(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<HomeResponseLoadResult> {
  try {
    const { data, error } = await supabase
      .from('attempts')
      .select(HOME_ATTEMPT_COLUMNS)
      .eq('user_id', userId)
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(HOME_COMPLETED_ATTEMPT_LIMIT)

    if (error) {
      logHomeDataFailure('completed_attempts', 'query', error)
      return { status: 'failure', reason: 'query' }
    }

    const homeData = buildHomeResponseData(data)
    if (!homeData) {
      logHomeDataFailure('completed_attempts', 'invalid_response')
      return { status: 'failure', reason: 'invalid_response' }
    }
    return { status: 'ready', data: homeData }
  } catch (error) {
    logHomeDataFailure('completed_attempts', 'query', error)
    return { status: 'failure', reason: 'query' }
  }
}
