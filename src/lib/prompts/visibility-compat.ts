import 'server-only'

const MISSING_VISIBILITY_COLUMN_CODE = '42703'
const MISSING_VISIBILITY_COLUMN_MESSAGE = 'column prompts.free_practice_visible does not exist'

interface QueryResult<T> {
  data: T
  error: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Recognizes only the exact pre-curriculum schema error from Postgres/PostgREST. */
export function isMissingFreePracticeVisibilityColumn(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.code === MISSING_VISIBILITY_COLUMN_CODE &&
    error.message === MISSING_VISIBILITY_COLUMN_MESSAGE
  )
}

/**
 * Uses the visibility-aware query whenever the column exists. A legacy retry is
 * allowed only for the exact pre-curriculum schema error. Rechecking after the
 * retry closes the migration race where the column appears between requests.
 */
export async function queryWithFreePracticeVisibilityFallback<T>(
  visibleQuery: () => Promise<QueryResult<T>>,
  legacyQuery: () => Promise<QueryResult<T>>,
): Promise<QueryResult<T>> {
  const visible = await visibleQuery()
  if (!isMissingFreePracticeVisibilityColumn(visible.error)) return visible

  const legacy = await legacyQuery()
  if (legacy.error) return legacy

  const rechecked = await visibleQuery()
  return isMissingFreePracticeVisibilityColumn(rechecked.error) ? legacy : rechecked
}
