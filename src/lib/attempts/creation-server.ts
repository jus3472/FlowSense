import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  attemptStoragePath,
  customCreationSession,
  initialAttemptMetrics,
  libraryCreationSession,
  retryCreationSession,
  storedAttemptReuse,
} from '@/lib/attempts/creation'
import { ATTEMPT_FAILURE_CODES, type AttemptStatus } from '@/lib/attempts/lifecycle'
import {
  logAttemptDiagnostic,
  safeDiagnosticCode,
  type AttemptAdminClient,
} from '@/lib/attempts/server'
import { parseLibraryPrompt } from '@/lib/prompts/selection'
import type { CreateAttemptPayload } from '@/lib/recording/attempt-payload'
import { RUBRIC_VERSION } from '@/lib/scoring/v2/contracts'
import type { PracticeSessionDescriptor } from '@/lib/practice/session'

const CREATION_COLUMNS =
  'id, prompt_id, prompt_text, duration_ms, practice_mode, prompt_source, prompt_difficulty, rubric_version, retry_of_attempt_id, client_request_id, metrics, audio_path, transcript, status, failure_code'

export type AttemptCreationIntent = 'uploading' | 'abandoned'

export interface EnsuredAttemptCreation {
  attemptId: string
  storagePath: string
  status: AttemptStatus
  failureCode: string | null
  created: boolean
}

export type EnsureAttemptCreationResult =
  | { status: 'ready'; value: EnsuredAttemptCreation }
  | { status: 'abandoned' }
  | { status: 'conflict' }
  | { status: 'unavailable' }
  | { status: 'failure' }

async function authoritativeSession(
  admin: AttemptAdminClient,
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

function reuseStoredAttempt(
  stored: Parameters<typeof storedAttemptReuse>[0] & {
    status: AttemptStatus
    failure_code: string | null
  },
  payload: CreateAttemptPayload,
  userId: string,
  intent: AttemptCreationIntent,
  expectedAttemptId?: string,
): EnsureAttemptCreationResult {
  const reuse = storedAttemptReuse(stored, payload, userId, RUBRIC_VERSION)
  if (!reuse || (expectedAttemptId !== undefined && stored.id !== expectedAttemptId)) {
    return { status: 'conflict' }
  }
  if (
    intent === 'uploading' &&
    stored.status === 'failed' &&
    stored.failure_code === ATTEMPT_FAILURE_CODES.clientUploadAbandoned
  ) {
    return { status: 'abandoned' }
  }
  return {
    status: 'ready',
    value: {
      attemptId: stored.id,
      storagePath: reuse.storagePath,
      status: stored.status,
      failureCode: stored.failure_code,
      created: false,
    },
  }
}

async function findStoredAttempt(
  admin: AttemptAdminClient,
  userId: string,
  payload: CreateAttemptPayload,
) {
  return admin
    .from('attempts')
    .select(CREATION_COLUMNS)
    .eq('user_id', userId)
    .eq('client_request_id', payload.clientRequestId)
    .maybeSingle()
}

/**
 * Ensures one server-owned creation row for one browser request. Both normal
 * creation and page-teardown abandonment use this path, so request reordering
 * resolves through the unique `(user_id, client_request_id)` snapshot.
 */
export async function ensureAttemptCreation(input: {
  admin: AttemptAdminClient
  userId: string
  payload: CreateAttemptPayload
  intent: AttemptCreationIntent
  expectedAttemptId?: string
}): Promise<EnsureAttemptCreationResult> {
  const { admin, userId, payload, intent, expectedAttemptId } = input
  const existingResult = await findStoredAttempt(admin, userId, payload)
  if (existingResult.error) {
    logAttemptDiagnostic(
      'find_idempotent_attempt',
      'attempt_read_failed',
      null,
      existingResult.error,
    )
    return { status: 'failure' }
  }
  if (existingResult.data) {
    return reuseStoredAttempt(existingResult.data, payload, userId, intent, expectedAttemptId)
  }
  if (expectedAttemptId !== undefined) return { status: 'conflict' }

  const resolved = await authoritativeSession(admin, userId, payload)
  if (resolved.failed) return { status: 'failure' }
  if (!resolved.session) return { status: 'unavailable' }
  const session = resolved.session

  // The server is the only source of row ids. An optional browser id only binds
  // abandonment to a row that was found above; it can never seed a new row.
  const attemptId = randomUUID()
  const storagePath = attemptStoragePath(userId, attemptId, payload.mimeType)
  const metrics = initialAttemptMetrics(session, payload.mimeType, storagePath)
  const abandoned = intent === 'abandoned'
  const { data, error } = await admin
    .from('attempts')
    .insert({
      id: attemptId,
      user_id: userId,
      prompt_id: session.promptId,
      prompt_text: session.promptText,
      audio_path: abandoned ? storagePath : null,
      duration_ms: payload.durationMs,
      practice_mode: session.mode,
      prompt_source: session.source,
      prompt_difficulty: session.difficulty,
      rubric_version: RUBRIC_VERSION,
      retry_of_attempt_id: session.retryOfAttemptId,
      client_request_id: payload.clientRequestId,
      status: abandoned ? 'failed' : 'uploading',
      failure_code: abandoned ? ATTEMPT_FAILURE_CODES.clientUploadAbandoned : null,
      finished_at: abandoned ? new Date().toISOString() : null,
      metrics: JSON.parse(JSON.stringify(metrics)),
    })
    .select(CREATION_COLUMNS)
    .single()

  if (!error && data) {
    return {
      status: 'ready',
      value: {
        attemptId: data.id,
        storagePath,
        status: data.status,
        failureCode: data.failure_code,
        created: true,
      },
    }
  }

  if (safeDiagnosticCode(error) === '23505') {
    const raced = await findStoredAttempt(admin, userId, payload)
    if (raced.error) {
      logAttemptDiagnostic('reload_idempotent_attempt', 'attempt_read_failed', null, raced.error)
      return { status: 'failure' }
    }
    if (raced.data) {
      return reuseStoredAttempt(raced.data, payload, userId, intent, expectedAttemptId)
    }
  }

  logAttemptDiagnostic('create_attempt', 'attempt_create_failed', attemptId, error)
  return { status: 'failure' }
}

/** Terminalizes only an exact unprocessed creation row. It never deletes data. */
export async function abandonEnsuredAttempt(
  admin: AttemptAdminClient,
  userId: string,
  attempt: EnsuredAttemptCreation,
): Promise<{ status: 'ready'; abandoned: boolean } | { status: 'failure' }> {
  if (
    attempt.status === 'failed' &&
    attempt.failureCode === ATTEMPT_FAILURE_CODES.clientUploadAbandoned
  ) {
    return { status: 'ready', abandoned: true }
  }

  const { data, error } = await admin
    .from('attempts')
    .update({
      status: 'failed',
      failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
      audio_path: attempt.storagePath,
    })
    .eq('id', attempt.attemptId)
    .eq('user_id', userId)
    .in('status', ['uploading', 'transcribing'])
    .is('transcript', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logAttemptDiagnostic('abandon_upload', 'attempt_abandon_failed', attempt.attemptId, error)
    return { status: 'failure' }
  }
  return { status: 'ready', abandoned: data !== null }
}
