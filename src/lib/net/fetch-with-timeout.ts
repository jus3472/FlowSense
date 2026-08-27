export const NETWORK_TIMEOUT_MS = 30_000

export class RequestTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} took longer than ${Math.round(timeoutMs / 1000)} seconds.`)
    this.name = 'RequestTimeoutError'
  }
}

interface TimeoutOptions {
  label: string
  timeoutMs?: number
  discardNonOkBody?: boolean
}

const BODYLESS_STATUS = new Set([204, 205, 304])

async function bufferResponse(response: Response, discardNonOkBody: boolean): Promise<Response> {
  let body: ArrayBuffer | null = null
  if (!response.ok && discardNonOkBody) {
    await response.body?.cancel()
  } else if (response.body) {
    body = await response.arrayBuffer()
  }

  return new Response(BODYLESS_STATUS.has(response.status) ? null : body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * Every network boundary in the recording pipeline goes through here. Without
 * the AbortController a stalled request never settles, and the promise chain
 * behind it never reaches a terminal state, which is how a previous version left
 * people watching a spinner forever.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  { label, timeoutMs = NETWORK_TIMEOUT_MS, discardNonOkBody = false }: TimeoutOptions,
): Promise<Response> {
  const controller = new AbortController()
  const callerSignal = init.signal
  const abortFromCaller = () => controller.abort(callerSignal?.reason)

  if (callerSignal?.aborted) {
    abortFromCaller()
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  }

  let timedOut = false
  const timer = controller.signal.aborted
    ? undefined
    : setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)

  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    // Fetch settles when response headers arrive. Buffer the body before
    // clearing the timer so a truncated or stalled body cannot wait forever.
    return await bufferResponse(response, discardNonOkBody)
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(label, timeoutMs)
    if (callerSignal?.aborted) throw callerSignal.reason
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}
