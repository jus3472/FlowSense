/** Routes that require a session. Everything else is public. */
export const PROTECTED_PREFIXES = [
  '/home',
  '/practice',
  '/onboarding',
  '/record',
  '/history',
  '/progress',
  '/settings',
  '/attempts',
  '/debug',
]

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export type AttemptHref = `/attempts/${string}`

/** Canonical result route for every owned current, terminal, or unsupported attempt. */
export function attemptHref(attemptId: string): AttemptHref {
  return `/attempts/${encodeURIComponent(attemptId)}`
}
