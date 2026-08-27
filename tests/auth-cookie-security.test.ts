import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  createServerClient: vi.fn(),
  cookieStoreGetAll: vi.fn(() => []),
  cookieStoreSet: vi.fn(),
  cookies: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: mocks.createBrowserClient,
  createServerClient: mocks.createServerClient,
}))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@/lib/env/public', () => ({
  publicEnv: { supabaseUrl: 'https://supabase.example.test', supabasePublishableKey: 'public-key' },
}))
vi.mock('@/lib/env/server', () => ({
  customPracticeHandoffSecret: () => 'test-only-secret-with-enough-entropy',
}))

import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { supabaseAuthCookieOptions } from '@/lib/supabase/cookie-options'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { updateSession } from '@/lib/supabase/session'

interface CapturedCookieOptions {
  cookieOptions: ReturnType<typeof supabaseAuthCookieOptions>
  cookies?: {
    setAll(values: Array<{ name: string; value: string; options: Record<string, unknown> }>): void
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cookies.mockResolvedValue({
    getAll: mocks.cookieStoreGetAll,
    set: mocks.cookieStoreSet,
  })
  mocks.createBrowserClient.mockReturnValue({})
  mocks.createServerClient.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Supabase auth cookie policy', () => {
  it.each([
    ['production', true],
    ['development', false],
    ['test', false],
  ])('uses one policy in every factory for %s', async (environment, secure) => {
    vi.stubEnv('NODE_ENV', environment)

    createBrowserClient()
    await createServerClient()
    await updateSession(new NextRequest('http://localhost/login'))

    const expected = {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure,
    }
    expect(mocks.createBrowserClient.mock.calls[0]?.[2]?.cookieOptions).toEqual(expected)
    expect(
      (mocks.createServerClient.mock.calls[0]?.[2] as CapturedCookieOptions).cookieOptions,
    ).toEqual(expected)
    expect(
      (mocks.createServerClient.mock.calls[1]?.[2] as CapturedCookieOptions).cookieOptions,
    ).toEqual(expected)
  })

  it('leaves Supabase cookie names, chunks, and lifetime under library control', () => {
    expect(supabaseAuthCookieOptions('production')).not.toHaveProperty('name')
    expect(supabaseAuthCookieOptions('production')).not.toHaveProperty('maxAge')
    expect(supabaseAuthCookieOptions('production')).not.toHaveProperty('expires')
  })

  it('forwards Supabase cookie attributes unchanged on server writes', async () => {
    await createServerClient()
    const options = mocks.createServerClient.mock.calls[0]?.[2] as CapturedCookieOptions
    const supplied = {
      path: '/auth',
      sameSite: 'strict',
      secure: true,
      maxAge: 123,
      domain: 'example.test',
    }

    options.cookies?.setAll([{ name: 'sb-token.0', value: 'chunk', options: supplied }])

    expect(mocks.cookieStoreSet).toHaveBeenCalledExactlyOnceWith('sb-token.0', 'chunk', supplied)
  })

  it('forwards Supabase cookie attributes unchanged through session refresh responses', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const supplied = {
      path: '/',
      sameSite: 'lax',
      secure: true,
      httpOnly: false,
      maxAge: 123,
    }
    mocks.createServerClient.mockImplementation(
      (_url: string, _key: string, options: CapturedCookieOptions) => ({
        auth: {
          getUser: async () => {
            options.cookies?.setAll([{ name: 'sb-token.0', value: 'chunk', options: supplied }])
            return { data: { user: null } }
          },
        },
      }),
    )

    const response = await updateSession(new NextRequest('https://flowsense.example/login'))

    expect(response.cookies.get('sb-token.0')).toMatchObject({
      name: 'sb-token.0',
      value: 'chunk',
      ...supplied,
    })
  })
})
