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

export async function disputeFinding(
  attemptId: string,
  noteType: string,
  quote: string | null,
): Promise<{ score: number }> {
  const response = await fetchWithTimeout(
    `/api/attempts/${attemptId}/disputes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteType, quote }),
    },
    { label: 'Saving what you kept' },
  )
  if (!response.ok) throw new Error(await readError(response, 'That could not be saved.'))
  const body: unknown = await response.json()
  return {
    score:
      typeof (body as { score?: number }).score === 'number'
        ? (body as { score: number }).score
        : 0,
  }
}

export async function deleteAttempt(attemptId: string): Promise<void> {
  const response = await fetchWithTimeout(
    `/api/attempts/${attemptId}`,
    { method: 'DELETE' },
    { label: 'Deleting the response' },
  )
  if (!response.ok) throw new Error(await readError(response, 'It could not be deleted.'))
}
