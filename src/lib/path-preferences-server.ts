import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildLoadedPathPreferences,
  samePathPreferenceOrder,
  type LoadedPathPreferences,
} from '@/lib/path-preferences'
import type { PathSlug } from '@/lib/curriculum/contracts'
import type { Database } from '@/lib/types/database'

const PATH_COLUMNS = 'id, slug, title, mode, position, active'
const PREFERENCE_COLUMNS = 'path_id, rank'

export type PathPreferencesLoadResult =
  | { status: 'ready'; data: LoadedPathPreferences }
  | { status: 'failure'; reason: 'query_error' | 'invalid_response'; error: unknown }

export type PathPreferencesSaveResult =
  | { status: 'saved'; data: LoadedPathPreferences }
  | { status: 'failure'; reason: 'query_error' | 'invalid_response' | 'readback_mismatch' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeErrorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'unknown'
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : 'unknown'
}

export function logPathPreferencesFailure(
  operation: 'onboarding' | 'settings',
  result: { reason: string; error?: unknown },
): void {
  console.error('[paths] preference operation failed', {
    operation,
    reason: result.reason,
    code: safeErrorCode(result.error),
  })
}

/** Loads the complete path catalog and the authenticated user's ordered selection. */
export async function loadPathPreferencesForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<PathPreferencesLoadResult> {
  try {
    const [paths, preferences] = await Promise.all([
      supabase
        .from('practice_paths')
        .select(PATH_COLUMNS)
        .eq('active', true)
        .order('position', { ascending: true }),
      supabase
        .from('profile_path_preferences')
        .select(PREFERENCE_COLUMNS)
        .eq('user_id', userId)
        .order('rank', { ascending: true }),
    ])
    if (paths.error) return { status: 'failure', reason: 'query_error', error: paths.error }
    if (preferences.error) {
      return { status: 'failure', reason: 'query_error', error: preferences.error }
    }
    const data = buildLoadedPathPreferences(paths.data, preferences.data)
    return data
      ? { status: 'ready', data }
      : { status: 'failure', reason: 'invalid_response', error: null }
  } catch (error) {
    return { status: 'failure', reason: 'query_error', error }
  }
}

/** Calls the Phase 1 transaction and proves the ordered readback before reporting success. */
export async function replacePathPreferencesForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  orderedSlugs: readonly PathSlug[],
): Promise<PathPreferencesSaveResult> {
  const current = await loadPathPreferencesForUser(supabase, userId)
  if (current.status === 'failure') return current

  const idBySlug = new Map(current.data.paths.map((path) => [path.slug, path.id]))
  const pathIds = orderedSlugs.map((slug) => idBySlug.get(slug))
  if (pathIds.some((id): id is undefined => id === undefined)) {
    return { status: 'failure', reason: 'invalid_response' }
  }

  try {
    const { error } = await supabase.rpc('replace_profile_path_preferences', {
      path_ids: pathIds as string[],
    })
    if (error) return { status: 'failure', reason: 'query_error' }
  } catch {
    return { status: 'failure', reason: 'query_error' }
  }

  const readback = await loadPathPreferencesForUser(supabase, userId)
  if (readback.status === 'failure') return readback
  if (!samePathPreferenceOrder(readback.data, orderedSlugs)) {
    return { status: 'failure', reason: 'readback_mismatch' }
  }
  return { status: 'saved', data: readback.data }
}
