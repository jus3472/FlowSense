export type AuthMode = 'signup' | 'login'

export const MINIMUM_PASSWORD_LENGTH = 8

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Returns a specific message, or null when the value is fine. */
export function validateEmail(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'Enter your email address.'
  if (!EMAIL_PATTERN.test(trimmed)) return 'Enter an email address in the form name@example.com.'
  return null
}

export function validatePassword(value: string, mode: AuthMode): string | null {
  if (value.length === 0) return 'Enter your password.'
  if (mode === 'signup' && value.length < MINIMUM_PASSWORD_LENGTH) {
    return `Use at least ${MINIMUM_PASSWORD_LENGTH} characters.`
  }
  return null
}

export function isAuthMode(value: unknown): value is AuthMode {
  return value === 'signup' || value === 'login'
}

export const MAXIMUM_DISPLAY_NAME_LENGTH = 60

export function validateDisplayName(value: string): string | null {
  if (value.trim().length > MAXIMUM_DISPLAY_NAME_LENGTH) {
    return `Use ${MAXIMUM_DISPLAY_NAME_LENGTH} characters or fewer.`
  }
  return null
}
