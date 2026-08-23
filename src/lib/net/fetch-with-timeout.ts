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
  { label, timeoutMs = NETWORK_TIMEOUT_MS }: TimeoutOptions,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new RequestTimeoutError(label, timeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
