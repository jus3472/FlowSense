import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/env/public', () => ({
  publicEnv: { supabaseUrl: 'https://supabase.example.test', supabasePublishableKey: 'public-key' },
}))
vi.mock('@/lib/env/server', () => ({
  customPracticeHandoffSecret: () => 'test-only-secret-with-enough-entropy',
}))

import { CUSTOM_HANDOFF_HEADER, sealCustomPracticeHandoff } from '@/lib/practice/custom-handoff'
import { CUSTOM_SESSION_COOKIE } from '@/lib/practice/custom'
import { updateSession } from '@/lib/supabase/session'

const userId = '10000000-0000-4000-8000-000000000001'
const secret = 'test-only-secret-with-enough-entropy'
const practice = {
  promptText: 'Explain a choice you made.',
  mode: 'practice' as const,
  additionalContext: 'Keep it private.',
  targetDurationSeconds: 30,
}

beforeEach(() => {
  mocks.createServerClient.mockReset()
})

describe('custom handoff session refresh', () => {
  it('forwards refreshed auth cookies and only the Proxy-validated custom header', async () => {
    const token = sealCustomPracticeHandoff(practice, userId, secret, {
      now: Date.now(),
      iv: Uint8Array.from({ length: 12 }, (_, index) => index + 1),
    })
    expect(token).not.toBeNull()

    mocks.createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        options: {
          cookies: {
            setAll: (
              values: Array<{
                name: string
                value: string
                options: { path: string }
              }>,
            ) => void
          }
        },
      ) => ({
        auth: {
          getUser: async () => {
            options.cookies.setAll([
              { name: 'sb-refresh', value: 'fresh-token', options: { path: '/' } },
            ])
            return {
              data: {
                user: { id: userId, user_metadata: { onboarded_at: '2026-08-27T00:00:00Z' } },
              },
            }
          },
        },
      }),
    )

    const request = new NextRequest('https://flowsense.example/record?custom=1', {
      headers: {
        cookie: `sb-refresh=old-token; ${CUSTOM_SESSION_COOKIE}=${token}`,
        [CUSTOM_HANDOFF_HEADER]: 'browser-spoof',
      },
    })
    const response = await updateSession(request)

    expect(response.headers.get('x-middleware-request-cookie')).toContain('sb-refresh=fresh-token')
    expect(response.headers.get('x-middleware-request-cookie')).not.toContain(CUSTOM_SESSION_COOKIE)
    expect(response.headers.get(`x-middleware-request-${CUSTOM_HANDOFF_HEADER}`)).not.toBe(
      'browser-spoof',
    )
    expect(response.headers.get(`x-middleware-request-${CUSTOM_HANDOFF_HEADER}`)).toBeTruthy()
    expect(response.cookies.get('sb-refresh')?.value).toBe('fresh-token')
    expect(response.cookies.get(CUSTOM_SESSION_COOKIE)?.value).toBe('')
  })

  it('clears a pending handoff while preserving the unauthenticated redirect', async () => {
    const token = sealCustomPracticeHandoff(practice, userId, secret, { now: Date.now() })
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })
    const request = new NextRequest('https://flowsense.example/record?custom=1', {
      headers: { cookie: `${CUSTOM_SESSION_COOKIE}=${token}` },
    })

    const response = await updateSession(request)

    expect(response.headers.get('location')).toBe('https://flowsense.example/login')
    expect(response.cookies.get(CUSTOM_SESSION_COOKIE)?.value).toBe('')
  })

  it('preserves a Secure Supabase cookie through handoff and the final redirect', async () => {
    const token = sealCustomPracticeHandoff(practice, userId, secret, { now: Date.now() })
    expect(token).not.toBeNull()
    mocks.createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        options: {
          cookies: {
            setAll: (
              values: Array<{
                name: string
                value: string
                options: { path: string; secure: boolean; sameSite: 'lax' }
              }>,
            ) => void
          }
        },
      ) => ({
        auth: {
          getUser: async () => {
            options.cookies.setAll([
              {
                name: 'sb-refresh',
                value: 'fresh-token',
                options: { path: '/', secure: true, sameSite: 'lax' },
              },
            ])
            return { data: { user: { id: userId, user_metadata: {} } } }
          },
        },
      }),
    )
    const request = new NextRequest('https://flowsense.example/record?custom=1', {
      headers: { cookie: `sb-refresh=old-token; ${CUSTOM_SESSION_COOKIE}=${token}` },
    })

    const response = await updateSession(request)

    expect(response.headers.get('location')).toBe('https://flowsense.example/onboarding')
    expect(response.cookies.get('sb-refresh')).toMatchObject({
      value: 'fresh-token',
      path: '/',
      secure: true,
      sameSite: 'lax',
    })
  })

  it('preserves the onboarding redirect for an incomplete authenticated user', async () => {
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: async () => ({ data: { user: { id: userId, user_metadata: {} } } }),
      },
    })
    const response = await updateSession(new NextRequest('https://flowsense.example/home'))

    expect(response.headers.get('location')).toBe('https://flowsense.example/onboarding')
  })
})
