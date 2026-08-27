import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'
import { promiseWithTimeout } from '@/lib/net/promise-with-timeout'

const options = { label: 'Checking your session', timeoutMs: 1_000 }

afterEach(() => {
  vi.useRealTimers()
})

describe('promiseWithTimeout', () => {
  it('returns the source value and clears its timer', async () => {
    vi.useFakeTimers()

    await expect(promiseWithTimeout(Promise.resolve('token'), options)).resolves.toBe('token')

    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves a source rejection', async () => {
    const failure = new Error('Session refresh failed.')

    await expect(promiseWithTimeout(Promise.reject(failure), options)).rejects.toBe(failure)
  })

  it('rejects a source that does not settle by the deadline', async () => {
    vi.useFakeTimers()
    const pending = promiseWithTimeout(new Promise(() => undefined), options)
    const rejection = expect(pending).rejects.toEqual(
      new RequestTimeoutError(options.label, options.timeoutMs),
    )

    await vi.advanceTimersByTimeAsync(options.timeoutMs)

    await rejection
  })

  it('preserves caller cancellation and ignores a late source value', async () => {
    const controller = new AbortController()
    const cancellation = new DOMException('Navigation', 'AbortError')
    let resolveSource: ((value: string) => void) | undefined
    const source = new Promise<string>((resolve) => {
      resolveSource = resolve
    })
    const pending = promiseWithTimeout(source, { ...options, signal: controller.signal })

    controller.abort(cancellation)
    resolveSource?.('late-token')

    await expect(pending).rejects.toBe(cancellation)
  })

  it('rejects immediately when the caller is already aborted', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()

    await expect(
      promiseWithTimeout(Promise.resolve('unused'), { ...options, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
