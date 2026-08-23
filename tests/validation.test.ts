import { describe, expect, it } from 'vitest'
import {
  validateDisplayName,
  validateEmail,
  validatePassword,
  MAXIMUM_DISPLAY_NAME_LENGTH,
} from '@/lib/validation'

describe('validateEmail', () => {
  it('asks for an address when empty', () => {
    expect(validateEmail('  ')).toBe('Enter your email address.')
  })

  it('rejects an address with no domain', () => {
    expect(validateEmail('someone@')).toMatch(/name@example.com/)
  })

  it('accepts a normal address', () => {
    expect(validateEmail('reader@example.com')).toBeNull()
  })
})

describe('validatePassword', () => {
  it('asks for a password when empty', () => {
    expect(validatePassword('', 'login')).toBe('Enter your password.')
  })

  it('enforces a minimum length on sign up only', () => {
    expect(validatePassword('short', 'signup')).toBe('Use at least 8 characters.')
    expect(validatePassword('short', 'login')).toBeNull()
  })

  it('accepts a long enough password', () => {
    expect(validatePassword('eight888', 'signup')).toBeNull()
  })
})

describe('validateDisplayName', () => {
  it('allows an empty name', () => {
    expect(validateDisplayName('')).toBeNull()
  })

  it('rejects a name past the limit', () => {
    expect(validateDisplayName('a'.repeat(MAXIMUM_DISPLAY_NAME_LENGTH + 1))).toMatch(/60/)
  })
})
