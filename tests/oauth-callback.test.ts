import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearHandoff: vi.fn(),
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}))

vi.mock('@/lib/practice/custom-handoff-cookie', () => ({
  clearCustomPracticeHandoffCookie: mocks.clearHandoff,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { GET } from '@/app/auth/callback/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  })
})

describe('OAuth callback', () => {
  it('exchanges one code, clears temporary handoff state, and redirects through root routing', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null })

    const response = await GET(
      new Request('https://flowsense-web.vercel.app/auth/callback?code=one-time-code'),
    )

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('one-time-code')
    expect(mocks.clearHandoff).toHaveBeenCalledOnce()
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    'https://flowsense-web.vercel.app/auth/callback',
    'https://flowsense-web.vercel.app/auth/callback?code=one&code=two',
  ])('rejects a missing or repeated code without contacting Supabase: %s', async (url) => {
    const response = await GET(new Request(url))

    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/login?mode=login&oauth=failed')
  })

  it('does not honor an external next destination or expose provider errors', async () => {
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { code: 'private-provider-code', message: 'private provider details' },
    })

    const response = await GET(
      new Request(
        'https://flowsense-web.vercel.app/auth/callback?code=bad&next=https://evil.example',
      ),
    )

    expect(response.headers.get('location')).toBe('/login?mode=login&oauth=failed')
    expect(JSON.stringify(logging.mock.calls)).not.toContain('private provider details')
    expect(JSON.stringify(logging.mock.calls)).not.toContain('private-provider-code')
  })
})
