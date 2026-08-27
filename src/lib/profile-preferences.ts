import { sanitizeFocusAreas } from '@/lib/focus-areas'

export interface LoadedProfilePreferences {
  displayName: string
  focusAreas: string[]
  profileExists: boolean
}

export type ProfilePreferencesLoadResult =
  | { status: 'ready'; data: LoadedProfilePreferences }
  | {
      status: 'failure'
      reason: 'query_error' | 'invalid_response'
      error: unknown
    }

export type ProfilePreferencesLoadOperation = 'settings' | 'onboarding_practice_goals'

interface ProfileQueryResult {
  data: unknown
  error: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failure(
  reason: 'query_error' | 'invalid_response',
  error: unknown,
): ProfilePreferencesLoadResult {
  return { status: 'failure', reason, error }
}

function parseProfilePreferences(data: unknown): LoadedProfilePreferences | null {
  if (data === null) return { displayName: '', focusAreas: [], profileExists: false }
  if (!isRecord(data)) return null

  const displayName = data.display_name
  const focusAreas = data.focus_areas
  if (displayName !== undefined && displayName !== null && typeof displayName !== 'string') {
    return null
  }
  if (
    focusAreas !== undefined &&
    focusAreas !== null &&
    (!Array.isArray(focusAreas) || focusAreas.some((value) => typeof value !== 'string'))
  ) {
    return null
  }

  return {
    displayName: typeof displayName === 'string' ? displayName : '',
    focusAreas: sanitizeFocusAreas(Array.isArray(focusAreas) ? focusAreas : []),
    profileExists: true,
  }
}

/** Keeps an absent or legacy profile usable while failing closed on unreadable preferences. */
export async function loadProfilePreferences(
  query: PromiseLike<ProfileQueryResult>,
): Promise<ProfilePreferencesLoadResult> {
  let result: ProfileQueryResult
  try {
    result = await query
  } catch (error) {
    return failure('query_error', error)
  }

  if (result.error) return failure('query_error', result.error)
  const data = parseProfilePreferences(result.data)
  return data ? { status: 'ready', data } : failure('invalid_response', null)
}

function safeErrorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'unknown'
  return /^[A-Za-z0-9_-]{1,40}$/.test(error.code) ? error.code : 'unknown'
}

/** Logs bounded query metadata only, never profile values or database error text. */
export function logProfilePreferencesLoadFailure(
  operation: ProfilePreferencesLoadOperation,
  result: Extract<ProfilePreferencesLoadResult, { status: 'failure' }>,
): void {
  console.error('[profiles] preference load failed', {
    operation,
    reason: result.reason,
    code: safeErrorCode(result.error),
  })
}
