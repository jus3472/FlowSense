import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
  ContentProviderFailure,
  DEEPSEEK_CONTENT_MAX_TOKENS,
  createDeepSeekModel,
} from '@/lib/deepseek/provider'
import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'

const REQUEST = { system: 'Private system.', user: 'Private response.', timeoutMs: 1_000 }
const API_KEY = 'private-key'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DeepSeek provider transport and failure safety', () => {
  it('uses the bounded deterministic JSON request contract', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }))
    vi.stubGlobal('fetch', fetch)
    await expect(createDeepSeekModel(API_KEY).complete(REQUEST)).resolves.toBe('{}')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-flash', thinking: { type: 'disabled' },
      response_format: { type: 'json_object' }, temperature: 0,
      max_tokens: DEEPSEEK_CONTENT_MAX_TOKENS,
    })
  })

  it.each([
    [401, 'authentication_error'], [400, 'configuration_error'],
    [429, 'rate_limit'], [503, 'server_error'],
  ] as const)('maps HTTP %s without exposing the response body', async (status, code) => {
    const response = new Response('<html>private provider response</html>', { status })
    const text = vi.spyOn(response, 'text')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(createDeepSeekModel(API_KEY).complete(REQUEST)).rejects.toMatchObject({
      message: CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
      diagnostic: { code, status },
    })
    expect(text).not.toHaveBeenCalled()
  })

  it.each([
    [new RequestTimeoutError('private', 1_000), 'timeout'],
    [new Error('private network failure'), 'network_failure'],
  ] as const)('normalizes transport failures', async (failure, code) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))
    let thrown: unknown
    try { await createDeepSeekModel(API_KEY).complete(REQUEST) } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(ContentProviderFailure)
    expect(thrown).toMatchObject({ message: CONTENT_PROVIDER_UNAVAILABLE_MESSAGE, diagnostic: { code } })
    expect(JSON.stringify(thrown)).not.toContain('private')
  })
})
