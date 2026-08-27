/** Provider ceilings used by the server routes. */
export const TRANSCRIPTION_PROVIDER_TIMEOUT_MS = 25_000
export const SCORING_PROVIDER_TIMEOUT_MS = 30_000
export const SCORING_WORK_BUDGET_MS = 50_000

/** Supabase session refresh is not cancellable, so callers bound its wait. */
export const AUTH_SESSION_TIMEOUT_MS = 10_000

/** Browser ceilings leave each route time to persist its authoritative result. */
export const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 40_000
export const SCORING_REQUEST_TIMEOUT_MS = 75_000

/** Failure reporting is best effort and must not replace the original error. */
export const CLIENT_FAILURE_REPORT_TIMEOUT_MS = 5_000
