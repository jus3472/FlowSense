/** Routes that require a session. Everything else is public. */
export const PROTECTED_PREFIXES = [
  '/home',
  '/practice',
  '/onboarding',
  '/record',
  '/history',
  '/settings',
  '/attempts',
  '/debug',
]

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
