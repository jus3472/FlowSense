import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { abandonEnsuredAttempt, ensureAttemptCreation } from '@/lib/attempts/creation-server'
import { authenticatedAttemptContext } from '@/lib/attempts/server'
import { isUuid } from '@/lib/practice/session'
import { parseCreateAttemptPayload } from '@/lib/recording/attempt-payload'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function abandon(request: Request) {
  const context = await authenticatedAttemptContext()
  if (!context) return apiError('Your session ended. Log in and try again.', 401)
  const { userId, admin } = context

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('The request body was not valid JSON.', 400)
  }

  const expectedAttemptId = isRecord(body) ? body.attemptId : undefined
  if (expectedAttemptId !== undefined && !isUuid(expectedAttemptId)) {
    return apiError('The attempt id was invalid.', 400)
  }
  const parsed = parseCreateAttemptPayload(body)
  if (!parsed.ok) return apiError(parsed.error, 400)

  const ensured = await ensureAttemptCreation({
    admin,
    userId,
    payload: parsed.value,
    intent: 'abandoned',
    ...(expectedAttemptId ? { expectedAttemptId } : {}),
  })
  if (ensured.status === 'failure') {
    return apiError('The unfinished response could not be closed.', 500)
  }
  if (ensured.status === 'conflict' || ensured.status === 'abandoned') {
    return apiError('That recording request did not match this response.', 409)
  }
  if (ensured.status === 'unavailable') {
    return apiError(
      parsed.value.retryOfAttemptId
        ? 'That retry session is no longer available.'
        : 'That prompt is no longer available.',
      409,
    )
  }

  const result = await abandonEnsuredAttempt(admin, userId, ensured.value)
  if (result.status === 'failure') {
    return apiError('The unfinished response could not be closed.', 500)
  }
  return NextResponse.json({
    ok: true,
    attemptId: ensured.value.attemptId,
    abandoned: result.abandoned,
  })
}

export const POST = abandon
