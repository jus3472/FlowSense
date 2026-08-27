import { RequestTimeoutError } from '@/lib/net/fetch-with-timeout'

interface PromiseTimeoutOptions {
  label: string
  timeoutMs: number
  signal?: AbortSignal
}

/**
 * Bounds a promise that cannot itself be cancelled. Once aborted or timed out,
 * a late result is still observed but cannot settle the returned promise again.
 */
export function promiseWithTimeout<T>(
  promise: PromiseLike<T>,
  { label, timeoutMs, signal }: PromiseTimeoutOptions,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () =>
      finish(() => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')))

    const timer = setTimeout(
      () => finish(() => reject(new RequestTimeoutError(label, timeoutMs))),
      timeoutMs,
    )
    Promise.resolve(promise).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )

    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}
