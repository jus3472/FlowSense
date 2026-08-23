/** Routes that require a session. Everything else is public. */
export const PROTECTED_PREFIXES = [
  '/home',
  '/onboarding',
  '/record',
  '/history',
  '/settings',
  '/attempts',
]

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
