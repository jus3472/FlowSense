import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import { clientFailureTransition, parseClientFailureReport } from '@/lib/attempts/client-failure'
import { authenticatedAttemptContext, transitionOwnedAttemptDetailed } from '@/lib/attempts/server'
import { isUuid } from '@/lib/practice/session'

/** Persists a bounded browser-observed failure only while its stage is still current. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return apiError('That attempt does not exist.', 404)

  const context = await authenticatedAttemptContext()
  if (!context) return apiError('Your session ended. Log in and try again.', 401)
  const { userId, admin } = context

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('The request body was not valid JSON.', 400)
  }

  const report = parseClientFailureReport(body)
  if (!report) return apiError('The processing failure report was invalid.', 400)

  const transition = clientFailureTransition(report)
  const result = await transitionOwnedAttemptDetailed(
    admin,
    userId,
    id,
    transition.expectedStatuses,
    transition.status,
    { failure_code: transition.failureCode },
  )
  if (result === 'failure') {
    return apiError('The processing state could not be saved.', 500)
  }

  // A provider response may already have advanced or completed the attempt.
  // A stale browser report is therefore a successful no-op.
  return NextResponse.json({ ok: true, persisted: result === 'updated' })
}
