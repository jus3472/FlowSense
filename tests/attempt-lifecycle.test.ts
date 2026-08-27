import { describe, expect, it } from 'vitest'
import {
  attemptStoragePath,
  customCreationSession,
  initialAttemptMetrics,
  libraryCreationSession,
  retryCreationSession,
  storedAttemptReuse,
} from '@/lib/attempts/creation'
import {
  ATTEMPT_STATUSES,
  canFinalizeAttemptUpload,
  canRunScoring,
  canRunTranscription,
  canTransitionAttempt,
  classifyAttemptRubric,
  isAttemptStatus,
} from '@/lib/attempts/lifecycle'
import type { CreateAttemptPayload } from '@/lib/recording/attempt-payload'
import type { LibraryPrompt } from '@/lib/prompts/selection'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const PROMPT_ID = '30000000-0000-4000-8000-000000000003'
const REQUEST_ID = '40000000-0000-4000-8000-000000000004'

const PROMPT: LibraryPrompt = {
  id: PROMPT_ID,
  text: 'Describe a useful routine.',
  mode: 'practice',
  difficulty: 'beginner',
  targetDurationSeconds: 30,
  collectionId: 'explanation',
}

const LIBRARY_REQUEST: CreateAttemptPayload = {
  clientRequestId: REQUEST_ID,
  promptId: PROMPT_ID,
  promptText: PROMPT.text,
  mode: 'practice',
  difficulty: 'beginner',
  source: 'library',
  targetDurationSeconds: 30,
  retryOfAttemptId: null,
  mimeType: 'audio/webm;codecs=opus',
  durationMs: 12_400,
}

describe('attempt lifecycle contract', () => {
  it('matches the database transition graph exactly', () => {
    expect(canTransitionAttempt('uploading', 'transcribing')).toBe(true)
    expect(canTransitionAttempt('transcribing', 'scoring')).toBe(true)
    expect(canTransitionAttempt('scoring', 'done')).toBe(true)
    expect(canTransitionAttempt('failed', 'transcribing')).toBe(true)
    expect(canTransitionAttempt('timed_out', 'scoring')).toBe(true)
    expect(canTransitionAttempt('done', 'scoring')).toBe(false)
    expect(canTransitionAttempt('uploading', 'done')).toBe(false)
  })

  it('defines stage admission and rejects unknown statuses', () => {
    expect(ATTEMPT_STATUSES.every(isAttemptStatus)).toBe(true)
    expect(isAttemptStatus('complete')).toBe(false)
    expect(canFinalizeAttemptUpload('uploading')).toBe(true)
    expect(canFinalizeAttemptUpload('done')).toBe(false)
    expect(canRunTranscription('failed')).toBe(true)
    expect(canRunTranscription('uploading')).toBe(false)
    expect(canRunScoring('timed_out')).toBe(true)
    expect(canRunScoring('transcribing')).toBe(false)
  })

  it('allows only v2 or explicit legacy metadata into a scoring implementation', () => {
    expect(classifyAttemptRubric('v2')).toBe('v2')
    expect(classifyAttemptRubric('v1')).toBe('legacy')
    expect(classifyAttemptRubric(null)).toBe('legacy')
    expect(classifyAttemptRubric('v3')).toBe('unsupported')
    expect(classifyAttemptRubric(undefined)).toBe('unsupported')
  })
})

describe('authoritative attempt creation', () => {
  it('accepts an exact active library snapshot and rejects browser metadata changes', () => {
    expect(libraryCreationSession(LIBRARY_REQUEST, PROMPT)).toEqual({
      promptId: PROMPT_ID,
      promptText: PROMPT.text,
      mode: 'practice',
      difficulty: 'beginner',
      source: 'library',
      targetDurationSeconds: 30,
      retryOfAttemptId: null,
    })
    expect(
      libraryCreationSession({ ...LIBRARY_REQUEST, promptText: 'Forged text' }, PROMPT),
    ).toBeNull()
    expect(libraryCreationSession({ ...LIBRARY_REQUEST, mode: 'interview' }, PROMPT)).toBeNull()
    expect(
      libraryCreationSession({ ...LIBRARY_REQUEST, targetDurationSeconds: 60 }, PROMPT),
    ).toBeNull()
  })

  it('keeps custom prompts private and validates their fixed source shape', () => {
    const custom = {
      ...LIBRARY_REQUEST,
      promptId: null,
      promptText: 'Explain why this matters to you.',
      source: 'custom' as const,
      mode: 'conversation' as const,
      additionalContext: 'Use a recent example.',
    }
    expect(customCreationSession(custom)).toEqual({
      promptId: null,
      promptText: custom.promptText,
      mode: 'conversation',
      difficulty: 'beginner',
      source: 'custom',
      targetDurationSeconds: 30,
      retryOfAttemptId: null,
      additionalContext: 'Use a recent example.',
    })
    expect(customCreationSession({ ...custom, promptId: PROMPT_ID })).toBeNull()
    expect(customCreationSession({ ...custom, difficulty: 'advanced' })).toBeNull()
  })

  it('derives retries only from a completed owned parent snapshot', () => {
    const requested: CreateAttemptPayload = {
      ...LIBRARY_REQUEST,
      retryOfAttemptId: ATTEMPT_ID,
    }
    const parent = {
      id: ATTEMPT_ID,
      prompt_id: PROMPT_ID,
      prompt_text: PROMPT.text,
      practice_mode: 'practice',
      prompt_source: 'library',
      prompt_difficulty: 'beginner',
      metrics: { practice: { target_duration_seconds: 30 } },
      status: 'done',
    }
    expect(retryCreationSession(requested, parent)).toMatchObject({
      promptText: PROMPT.text,
      retryOfAttemptId: ATTEMPT_ID,
    })
    expect(retryCreationSession(requested, { ...parent, status: 'scoring' })).toBeNull()
    expect(retryCreationSession({ ...requested, mode: 'interview' }, parent)).toBeNull()
  })

  it('reuses one immutable creation snapshot without resolving its current source', () => {
    const session = libraryCreationSession(LIBRARY_REQUEST, PROMPT)
    expect(session).not.toBeNull()
    if (!session) return
    const storagePath = attemptStoragePath(USER_ID, ATTEMPT_ID, LIBRARY_REQUEST.mimeType)
    const metrics = initialAttemptMetrics(session, LIBRARY_REQUEST.mimeType, storagePath)
    const stored = {
      id: ATTEMPT_ID,
      prompt_id: session.promptId,
      prompt_text: session.promptText,
      duration_ms: LIBRARY_REQUEST.durationMs,
      practice_mode: session.mode,
      prompt_source: session.source,
      prompt_difficulty: session.difficulty,
      rubric_version: 'v2',
      retry_of_attempt_id: null,
      client_request_id: REQUEST_ID,
      metrics,
    }

    expect(storagePath).toBe(`${USER_ID}/${ATTEMPT_ID}.webm`)
    expect(storedAttemptReuse(stored, LIBRARY_REQUEST, USER_ID, 'v2')).toEqual({ storagePath })
    expect(
      storedAttemptReuse(
        { ...stored, prompt_id: null, retry_of_attempt_id: null },
        LIBRARY_REQUEST,
        USER_ID,
        'v2',
      ),
    ).toEqual({ storagePath })
  })

  it('reuses a stored retry after its parent foreign key becomes unavailable', () => {
    const request: CreateAttemptPayload = {
      ...LIBRARY_REQUEST,
      retryOfAttemptId: ATTEMPT_ID,
    }
    const session = retryCreationSession(request, {
      id: ATTEMPT_ID,
      prompt_id: PROMPT_ID,
      prompt_text: PROMPT.text,
      practice_mode: 'practice',
      prompt_source: 'library',
      prompt_difficulty: 'beginner',
      metrics: { practice: { target_duration_seconds: 30 } },
      status: 'done',
    })
    expect(session).not.toBeNull()
    if (!session) return

    const retryId = '20000000-0000-4000-8000-000000000004'
    const storagePath = attemptStoragePath(USER_ID, retryId, request.mimeType)
    const stored = {
      id: retryId,
      prompt_id: null,
      prompt_text: session.promptText,
      duration_ms: request.durationMs,
      practice_mode: session.mode,
      prompt_source: session.source,
      prompt_difficulty: session.difficulty,
      rubric_version: 'v2',
      retry_of_attempt_id: null,
      client_request_id: request.clientRequestId,
      metrics: initialAttemptMetrics(session, request.mimeType, storagePath),
    }

    expect(storedAttemptReuse(stored, request, USER_ID, 'v2')).toEqual({ storagePath })
  })

  it('rejects conflicting idempotency-key reuse', () => {
    const session = libraryCreationSession(LIBRARY_REQUEST, PROMPT)
    expect(session).not.toBeNull()
    if (!session) return
    const storagePath = attemptStoragePath(USER_ID, ATTEMPT_ID, LIBRARY_REQUEST.mimeType)
    const stored = {
      id: ATTEMPT_ID,
      prompt_id: session.promptId,
      prompt_text: session.promptText,
      duration_ms: LIBRARY_REQUEST.durationMs,
      practice_mode: session.mode,
      prompt_source: session.source,
      prompt_difficulty: session.difficulty,
      rubric_version: 'v2',
      retry_of_attempt_id: null,
      client_request_id: REQUEST_ID,
      metrics: initialAttemptMetrics(session, LIBRARY_REQUEST.mimeType, storagePath),
    }

    expect(
      storedAttemptReuse(
        stored,
        { ...LIBRARY_REQUEST, durationMs: LIBRARY_REQUEST.durationMs + 1 },
        USER_ID,
        'v2',
      ),
    ).toBeNull()
    expect(
      storedAttemptReuse(stored, { ...LIBRARY_REQUEST, mimeType: 'audio/mp4' }, USER_ID, 'v2'),
    ).toBeNull()
    expect(
      storedAttemptReuse(
        { ...stored, metrics: { ...stored.metrics, creation: undefined } },
        LIBRARY_REQUEST,
        USER_ID,
        'v2',
      ),
    ).toBeNull()
  })
})
