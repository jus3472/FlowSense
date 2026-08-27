import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout, RequestTimeoutError } from '@/lib/net/fetch-with-timeout'

const options = { label: 'Fetching the result', timeoutMs: 1_000 }

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('fetchWithTimeout', () => {
  it('returns a successful response', async () => {
    const response = new Response('ok', {
      status: 201,
      headers: { 'Content-Type': 'text/plain', 'X-Test': 'kept' },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    const buffered = await fetchWithTimeout('https://example.com', {}, options)

    expect(buffered.status).toBe(201)
    expect(buffered.headers.get('X-Test')).toBe('kept')
    await expect(buffered.text()).resolves.toBe('ok')
  })

  it('reports a timer-triggered abort as a RequestTimeoutError', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
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

  it('preserves a caller abort while the response body is being read', async () => {
    const caller = new AbortController()
    const abortError = new DOMException('You left this page', 'AbortError')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), {
              once: true,
            })
          },
        })
        return new Response(body)
      }),
    )

    const request = fetchWithTimeout('https://example.com', { signal: caller.signal }, options)
    caller.abort(abortError)

    await expect(request).rejects.toBe(abortError)
  })

  it('keeps the deadline active after headers while the response body stalls', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          },
        })
        return new Response(body)
      }),
    )

    const request = fetchWithTimeout('https://example.com', {}, options)
    const rejection = expect(request).rejects.toEqual(
      new RequestTimeoutError(options.label, options.timeoutMs),
    )
    await vi.advanceTimersByTimeAsync(options.timeoutMs)

    await rejection
  })

  it('returns a bounded truncated body that JSON parsing rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":')))

    const response = await fetchWithTimeout('https://example.com', {}, options)

    await expect(response.json()).rejects.toBeInstanceOf(SyntaxError)
  })

  it('discards a non-ok body without reading it', async () => {
    const original = new Response('private provider body', { status: 503 })
    if (!original.body) throw new Error('The response fixture requires a body.')
    const cancel = vi.spyOn(original.body, 'cancel')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => original),
    )

    const response = await fetchWithTimeout(
      'https://example.com',
      {},
      {
        ...options,
        discardNonOkBody: true,
      },
    )

    expect(response.status).toBe(503)
    expect(response.body).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
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
