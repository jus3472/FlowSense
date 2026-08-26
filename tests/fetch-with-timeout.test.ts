import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout, RequestTimeoutError } from '@/lib/net/fetch-with-timeout'

const options = { label: 'Fetching the result', timeoutMs: 1_000 }

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('fetchWithTimeout', () => {
  it('returns a successful response', async () => {
    const response = new Response('ok')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(fetchWithTimeout('https://example.com', {}, options)).resolves.toBe(response)
  })

  it('reports a timer-triggered abort as a RequestTimeoutError', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      ),
    )

    const request = fetchWithTimeout('https://example.com', {}, options)
    const rejection = expect(request).rejects.toEqual(
      new RequestTimeoutError(options.label, options.timeoutMs),
    )
    await vi.advanceTimersByTimeAsync(options.timeoutMs)

    await rejection
  })

  it('preserves a caller-triggered abort error', async () => {
    const caller = new AbortController()
    const abortError = new DOMException('You cancelled this request', 'AbortError')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          }),
      ),
    )

    const request = fetchWithTimeout('https://example.com', { signal: caller.signal }, options)
    caller.abort(abortError)

    await expect(request).rejects.toBe(abortError)
  })

  it('removes its caller listener and clears its timer after the request settles', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const removeEventListener = vi.spyOn(caller.signal, 'removeEventListener')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')))

    await fetchWithTimeout('https://example.com', { signal: caller.signal }, options)

    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})
