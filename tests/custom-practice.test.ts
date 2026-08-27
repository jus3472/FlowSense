import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  isCustomPracticeMarker,
  parseCustomPracticeInput,
  validateCustomPracticeInput,
} from '@/lib/practice/custom'

vi.mock('server-only', () => ({}))

import {
  CUSTOM_HANDOFF_COOKIE_VALUE_MAX_BYTES,
  openCustomPracticeHandoff,
  parseCustomPracticeHeader,
  resolveCustomPracticeHandoff,
  sealCustomPracticeHandoff,
} from '@/lib/practice/custom-handoff'

const valid = {
  promptText: 'Explain a choice you made.',
  mode: 'practice' as const,
  additionalContext: 'Keep it brief.',
  targetDurationSeconds: 30,
}
const userId = '10000000-0000-4000-8000-000000000001'
const secret = 'test-only-secret-with-enough-entropy'
const now = Date.UTC(2026, 7, 27)
const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 1)

describe('custom practice input', () => {
  it('trims and parses a private transport payload', () => {
    const parsed = parseCustomPracticeInput({
      ...valid,
      promptText: '  Explain a choice you made.  ',
    })
    expect(parsed).toEqual(valid)
  })
  it.each([
    { ...valid, promptText: ' ' },
    { ...valid, mode: 'other' },
    { ...valid, targetDurationSeconds: 14 },
    { ...valid, targetDurationSeconds: 61 },
    { ...valid, additionalContext: 'x'.repeat(1001) },
  ])('rejects malformed or out-of-range input', (input) => {
    expect(parseCustomPracticeInput(input)).toBeNull()
  })
  it('accepts valid Unicode within the real byte budget', () => {
    const input = { ...valid, promptText: `Describe ${'水'.repeat(400)}` }
    expect(validateCustomPracticeInput(input)).toEqual({ ok: true, value: input })
  })
  it('rejects product-valid character counts that exceed the storage byte budget', () => {
    const result = validateCustomPracticeInput({
      ...valid,
      promptText: '🙂'.repeat(600),
      additionalContext: '界'.repeat(600),
    })
    expect(result).toEqual({ ok: false, reason: 'too_large' })
  })
  it.each([undefined, '0', 'true', ['1'], ['1', '1'], 1])(
    'does not activate a custom session for an invalid marker',
    (marker) => expect(isCustomPracticeMarker(marker)).toBe(false),
  )
  it('activates a custom session only for the singular action marker', () => {
    expect(isCustomPracticeMarker('1')).toBe(true)
    const action = readFileSync('src/actions/custom-practice.ts', 'utf8')
    const recordPage = readFileSync('src/app/(app)/record/page.tsx', 'utf8')
    expect(action).toContain("redirect('/record?custom=1')")
    expect(recordPage).toContain('if (!session && isCustomPracticeMarker(params.custom))')
    expect(recordPage).toContain('title="Your custom prompt is not available"')
    expect(recordPage.indexOf('isCustomPracticeMarker(params.custom)')).toBeLessThan(
      recordPage.indexOf('resolveLibraryPromptSession(params.prompt'),
    )
    expect(recordPage).toContain("if (invalidIntent === 'custom')")
    expect(recordPage.indexOf("invalidIntent === 'custom'")).toBeLessThan(
      recordPage.indexOf('pickRecordPrompt('),
    )
  })
  it('keeps custom prompt transport out of the public prompt library', () => {
    expect(readFileSync('src/actions/custom-practice.ts', 'utf8')).not.toContain(".from('prompts')")
  })
})

describe('custom practice handoff', () => {
  it.each([
    valid,
    { ...valid, additionalContext: undefined },
    { ...valid, targetDurationSeconds: 15 },
    { ...valid, targetDurationSeconds: 60 },
  ])('encrypts and opens a user-bound session without plaintext in the token', (input) => {
    const token = sealCustomPracticeHandoff(input, userId, secret, { now, iv })
    expect(token).not.toBeNull()
    expect(token).not.toContain(input.promptText)
    if (input.additionalContext) expect(token).not.toContain(input.additionalContext)
    expect(Buffer.byteLength(token ?? '', 'utf8')).toBeLessThanOrEqual(
      CUSTOM_HANDOFF_COOKIE_VALUE_MAX_BYTES,
    )
    expect(openCustomPracticeHandoff(token ?? undefined, userId, secret, { now })).toEqual(input)
  })

  it('rejects expired, tampered, malformed, and differently owned sessions', () => {
    const token = sealCustomPracticeHandoff(valid, userId, secret, { now, iv })
    expect(token).not.toBeNull()
    expect(
      openCustomPracticeHandoff(token ?? undefined, userId, secret, {
        now: now + 5 * 60 * 1_000,
      }),
    ).toBeNull()
    expect(openCustomPracticeHandoff(`${token}x`, userId, secret, { now })).toBeNull()
    expect(openCustomPracticeHandoff('not-a-token', userId, secret, { now })).toBeNull()
    expect(
      openCustomPracticeHandoff(token ?? undefined, 'another-user', secret, { now }),
    ).toBeNull()
  })

  it('consumes once through cookie deletion and fails safely on refresh or replay', () => {
    const token = sealCustomPracticeHandoff(valid, userId, secret, { now, iv })
    const first = resolveCustomPracticeHandoff(token ?? undefined, userId, secret, { now })
    expect(first.clearCookie).toBe(true)
    expect(parseCustomPracticeHeader(first.headerValue)).toEqual(valid)

    // Proxy applies the first response's deletion before a refresh or back navigation.
    const replay = resolveCustomPracticeHandoff(undefined, userId, secret, { now })
    expect(replay).toEqual({ clearCookie: false, headerValue: null })
  })

  it('clears invalid and account-switched payloads without forwarding private state', () => {
    const token = sealCustomPracticeHandoff(valid, userId, secret, { now, iv })
    expect(resolveCustomPracticeHandoff(`${token}x`, userId, secret, { now })).toEqual({
      clearCookie: true,
      headerValue: null,
    })
    expect(
      resolveCustomPracticeHandoff(token ?? undefined, 'another-user', secret, { now }),
    ).toEqual({
      clearCookie: true,
      headerValue: null,
    })
  })

  it('keeps handoff state server-only and clears it on logout and successful authentication', () => {
    const handoff = readFileSync('src/lib/practice/custom-handoff.ts', 'utf8')
    const recordPage = readFileSync('src/app/(app)/record/page.tsx', 'utf8')
    const session = readFileSync('src/lib/supabase/session.ts', 'utf8')
    const logout = readFileSync('src/actions/auth.ts', 'utf8')
    const authenticate = readFileSync('src/actions/authenticate.ts', 'utf8')
    expect(handoff).toContain("import 'server-only'")
    expect(recordPage).not.toContain('cookies()')
    expect(recordPage).toContain('parseCustomPracticeHeader')
    expect(session).toContain('requestHeaders.delete(CUSTOM_HANDOFF_HEADER)')
    expect(session).toContain("path: '/record'")
    expect(logout).toContain('clearCustomPracticeHandoffCookie()')
    expect(authenticate.match(/clearCustomPracticeHandoffCookie\(\)/g)).toHaveLength(2)
  })
})
