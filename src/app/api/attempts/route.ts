import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { ensureAttemptCreation } from '@/lib/attempts/creation-server'
import { authenticatedAttemptContext } from '@/lib/attempts/server'
import { parseCreateAttemptPayload } from '@/lib/recording/attempt-payload'

/** Creates one server-owned attempt for one logical browser recording request. */
export async function POST(request: Request) {
  const context = await authenticatedAttemptContext()
  if (!context) return apiError('Your session ended. Log in and try again.', 401)
  const { userId, admin } = context

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('The request body was not valid JSON.', 400)
  }

  const parsed = parseCreateAttemptPayload(body)
  if (!parsed.ok) return apiError(parsed.error, 400)
  const payload = parsed.value

  const result = await ensureAttemptCreation({ admin, userId, payload, intent: 'uploading' })
  if (result.status === 'failure') return apiError('The attempt could not be created.', 500)
  if (result.status === 'conflict') {
    return apiError('That recording request was already used for different details.', 409)
  }
  if (result.status === 'abandoned') {
    return apiError('That recording request was already closed.', 409)
  }
  if (result.status === 'unavailable') {
    return apiError(
      payload.retryOfAttemptId
        ? 'That retry session is no longer available.'
        : payload.curriculum
          ? 'That lesson is no longer available.'
        : 'That prompt is no longer available.',
      409,
    )
  }
  return NextResponse.json({
    attemptId: result.value.attemptId,
    storagePath: result.value.storagePath,
  })
}
