import type { Route } from 'next'
import { fetchWithTimeout } from '@/lib/net/fetch-with-timeout'

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const message = (body as { error?: unknown }).error
      if (typeof message === 'string' && message.trim().length > 0) return message
    }
  } catch {
    // No JSON body. The fallback carries the status instead.
  }
  return `${fallback} The server answered ${response.status}.`
}

export interface DeleteAttemptOutcome {
  redirectTo: Route
}

function isDeleteAttemptOutcome(value: unknown): value is DeleteAttemptOutcome {
  if (!value || typeof value !== 'object' || !('redirectTo' in value)) return false
  const redirectTo = (value as { redirectTo?: unknown }).redirectTo
  return (
    typeof redirectTo === 'string' &&
    (redirectTo === '/history' ||
      redirectTo.startsWith('/attempts/') ||
      redirectTo.startsWith('/practice/paths/'))
  )
}

export async function deleteAttempt(attemptId: string): Promise<DeleteAttemptOutcome> {
  const response = await fetchWithTimeout(
    `/api/attempts/${attemptId}`,
    { method: 'DELETE' },
    { label: 'Deleting the response' },
  )
  if (!response.ok) throw new Error(await readError(response, 'It could not be deleted.'))
  const body: unknown = await response.json()
  if (!isDeleteAttemptOutcome(body)) {
    throw new Error('The response was deleted, but the next page could not be opened.')
  }
  return body
}
