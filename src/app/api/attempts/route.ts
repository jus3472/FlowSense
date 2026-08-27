import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/responses'
import {
  attemptStoragePath,
  customCreationSession,
  initialAttemptMetrics,
  libraryCreationSession,
  retryCreationSession,
  storedAttemptReuse,
} from '@/lib/attempts/creation'
import {
  authenticatedAttemptContext,
  logAttemptDiagnostic,
  safeDiagnosticCode,
} from '@/lib/attempts/server'
import {
  parseCreateAttemptPayload,
  type CreateAttemptPayload,
} from '@/lib/recording/attempt-payload'
import { parseLibraryPrompt } from '@/lib/prompts/selection'
import { RUBRIC_VERSION } from '@/lib/scoring/v2/contracts'
import type { PracticeSessionDescriptor } from '@/lib/practice/session'

const CREATION_COLUMNS =
  'id, prompt_id, prompt_text, duration_ms, practice_mode, prompt_source, prompt_difficulty, rubric_version, retry_of_attempt_id, client_request_id, metrics'

async function authoritativeSession(
  admin: NonNullable<Awaited<ReturnType<typeof authenticatedAttemptContext>>>['admin'],
  userId: string,
  payload: CreateAttemptPayload,
): Promise<{ session: PracticeSessionDescriptor | null; failed: boolean }> {
  if (payload.retryOfAttemptId) {
    const { data: parent, error } = await admin
      .from('attempts')
      .select(
        'id, prompt_id, prompt_text, practice_mode, prompt_source, prompt_difficulty, metrics, status',
      )
      .eq('id', payload.retryOfAttemptId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      logAttemptDiagnostic(
        'load_retry_parent',
        'retry_parent_read_failed',
        payload.retryOfAttemptId,
        error,
      )
      return { session: null, failed: true }
    }
    return { session: retryCreationSession(payload, parent), failed: false }
  }

  if (payload.source === 'custom') {
    return { session: customCreationSession(payload), failed: false }
  }

  const { data, error } = await admin
    .from('prompts')
    .select('id, text, active, mode, difficulty, target_duration_seconds, collection_id')
    .eq('id', payload.promptId ?? '')
    .eq('active', true)
    .maybeSingle()
  if (error) {
    logAttemptDiagnostic('load_library_prompt', 'library_prompt_read_failed', null, error)
    return { session: null, failed: true }
  }
  const prompt = parseLibraryPrompt(data)
  return { session: prompt ? libraryCreationSession(payload, prompt) : null, failed: false }
}

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

  const existingResult = await admin
    .from('attempts')
    .select(CREATION_COLUMNS)
    .eq('user_id', userId)
    .eq('client_request_id', payload.clientRequestId)
    .maybeSingle()
  if (existingResult.error) {
    logAttemptDiagnostic(
      'find_idempotent_attempt',
      'attempt_read_failed',
      null,
      existingResult.error,
    )
    return apiError('The attempt could not be created.', 500)
  }
  if (existingResult.data) {
    const reuse = storedAttemptReuse(existingResult.data, payload, userId, RUBRIC_VERSION)
    if (!reuse) {
      return apiError('That recording request was already used for different details.', 409)
    }
    return NextResponse.json({ attemptId: existingResult.data.id, storagePath: reuse.storagePath })
  }

  const resolved = await authoritativeSession(admin, userId, payload)
  if (resolved.failed) return apiError('The attempt could not be created.', 500)
  if (!resolved.session) {
    return apiError(
      payload.retryOfAttemptId
        ? 'That retry session is no longer available.'
        : 'That prompt is no longer available.',
      409,
    )
  }
  const session = resolved.session

  const attemptId = randomUUID()
  const storagePath = attemptStoragePath(userId, attemptId, payload.mimeType)
  const metrics = initialAttemptMetrics(session, payload.mimeType, storagePath)
  const { data, error } = await admin
    .from('attempts')
    .insert({
      id: attemptId,
      user_id: userId,
      prompt_id: session.promptId,
      prompt_text: session.promptText,
      duration_ms: payload.durationMs,
      practice_mode: session.mode,
      prompt_source: session.source,
      prompt_difficulty: session.difficulty,
      rubric_version: RUBRIC_VERSION,
      retry_of_attempt_id: session.retryOfAttemptId,
      client_request_id: payload.clientRequestId,
      status: 'uploading',
      metrics: JSON.parse(JSON.stringify(metrics)),
    })
    .select('id')
    .single()

  if (!error && data) return NextResponse.json({ attemptId: data.id, storagePath })

  if (safeDiagnosticCode(error) === '23505') {
    const raced = await admin
      .from('attempts')
      .select(CREATION_COLUMNS)
      .eq('user_id', userId)
      .eq('client_request_id', payload.clientRequestId)
      .maybeSingle()
    if (raced.data) {
      const reuse = storedAttemptReuse(raced.data, payload, userId, RUBRIC_VERSION)
      if (reuse) {
        return NextResponse.json({ attemptId: raced.data.id, storagePath: reuse.storagePath })
      }
      return apiError('That recording request was already used for different details.', 409)
    }
  }

  logAttemptDiagnostic('create_attempt', 'attempt_create_failed', attemptId, error)
  return apiError('The attempt could not be created.', 500)
}
