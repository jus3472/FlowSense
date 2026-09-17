import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  deepgramApiKey: vi.fn(() => 'server-api-key'),
  fetchWithTimeout: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/env/server', () => ({ deepgramApiKey: mocks.deepgramApiKey }))
vi.mock('@/lib/net/fetch-with-timeout', () => ({ fetchWithTimeout: mocks.fetchWithTimeout }))

import { POST } from '@/app/api/transcribe/live-token/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-id' } } })) },
  })
})

describe('live transcription token route', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  afterAll(() => warn.mockRestore())

  it('requires an authenticated user before requesting a provider token', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    })

    const response = await POST()

    expect(response.status).toBe(401)
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled()
  })

  it('returns only a non-cacheable short-lived token', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'temporary-jwt', expires_in: 30 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const response = await POST()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(await response.json()).toEqual({ token: 'temporary-jwt' })
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      'https://api.deepgram.com/v1/auth/grant',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Token server-api-key' }),
      }),
      expect.objectContaining({ timeoutMs: 10_000 }),
    )
  })

  it.each([
    ['a rejected grant', new Response('{}', { status: 403 })],
    ['a malformed grant', new Response(JSON.stringify({ expires_in: 30 }), { status: 200 })],
  ])('fails closed for %s', async (_label, providerResponse) => {
    mocks.fetchWithTimeout.mockResolvedValue(providerResponse)
    const response = await POST()
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('server-api-key')
    expect(warn).toHaveBeenCalledWith(
      '[live-transcription]',
      expect.objectContaining({ code: expect.stringMatching(/^grant_/) }),
    )
  })
})
