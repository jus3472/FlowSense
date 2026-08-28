import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logAttemptDiagnostic: vi.fn(),
  lessonAccess: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('node:crypto', () => ({
  randomUUID: () => '20000000-0000-4000-8000-000000000002',
}))
vi.mock('@/lib/attempts/server', () => ({
  logAttemptDiagnostic: mocks.logAttemptDiagnostic,
  safeDiagnosticCode: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown',
}))
vi.mock('@/lib/curriculum/server', () => ({
  loadCurriculumLessonAccessForUser: mocks.lessonAccess,
}))

import { abandonEnsuredAttempt, ensureAttemptCreation } from '@/lib/attempts/creation-server'
import {
  attemptStoragePath,
  customCreationSession,
  initialAttemptMetrics,
} from '@/lib/attempts/creation'
import { ATTEMPT_FAILURE_CODES, type AttemptStatus } from '@/lib/attempts/lifecycle'
import type { CreateAttemptPayload } from '@/lib/recording/attempt-payload'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const OTHER_ATTEMPT_ID = '20000000-0000-4000-8000-000000000099'
const REQUEST_ID = '30000000-0000-4000-8000-000000000003'
const PROMPT_ID = '40000000-0000-4000-8000-000000000004'
const MIME_TYPE = 'audio/webm;codecs=opus'
const LESSON_ID = '50000000-0000-4000-8000-000000000005'

const PAYLOAD: CreateAttemptPayload = {
  clientRequestId: REQUEST_ID,
  promptId: null,
  promptText: 'Explain a decision you made recently.',
  mode: 'conversation',
  difficulty: 'beginner',
  source: 'custom',
  targetDurationSeconds: 30,
  retryOfAttemptId: null,
  additionalContext: 'Keep the context private.',
  mimeType: MIME_TYPE,
  durationMs: 12_400,
}

interface StoredRow {
  id: string
  prompt_id: null
  prompt_text: string
  duration_ms: number
  practice_mode: 'conversation'
  prompt_source: 'custom'
  prompt_difficulty: 'beginner'
  rubric_version: 'v2'
  retry_of_attempt_id: null
  client_request_id: string
  metrics: ReturnType<typeof initialAttemptMetrics>
  audio_path: string | null
  transcript: string | null
  status: AttemptStatus
  failure_code: string | null
}

function storedRow(
  status: AttemptStatus,
  failureCode: string | null = null,
  id = ATTEMPT_ID,
): StoredRow {
  const session = customCreationSession(PAYLOAD)
  if (!session) throw new Error('expected valid custom session')
  const storagePath = attemptStoragePath(USER_ID, id, MIME_TYPE)
  return {
    id,
    prompt_id: null,
    prompt_text: PAYLOAD.promptText,
    duration_ms: PAYLOAD.durationMs,
    practice_mode: 'conversation',
    prompt_source: 'custom',
    prompt_difficulty: 'beginner',
    rubric_version: 'v2',
    retry_of_attempt_id: null,
    client_request_id: REQUEST_ID,
    metrics: initialAttemptMetrics(session, MIME_TYPE, storagePath),
    audio_path: status === 'failed' ? storagePath : null,
    transcript: null,
    status,
    failure_code: failureCode,
  }
}

function readQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

function insertQuery(result: { data: StoredRow | null; error: unknown }) {
  const query = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => result),
  }
  query.insert.mockReturnValue(query)
  query.select.mockReturnValue(query)
  return query
}

function updateQuery(result: { data: { id: string } | null; error: unknown }) {
  const query = {
    update: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  }
  query.update.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.in.mockReturnValue(query)
  query.is.mockReturnValue(query)
  query.select.mockReturnValue(query)
  return query
}

function adminFrom(...queries: object[]) {
  return { from: vi.fn().mockImplementation(() => queries.shift()) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('server attempt creation reconciliation', () => {
  it('revalidates a structured lesson and persists its server-owned identity', async () => {
    const payload: CreateAttemptPayload = {
      ...PAYLOAD,
      promptId: PROMPT_ID,
      promptText: 'Describe a choice you made recently.',
      mode: 'interview',
      source: 'library',
      additionalContext: undefined,
      targetDurationSeconds: 60,
      curriculum: {
        lessonId: LESSON_ID,
        pathSlug: 'interviews',
        chapterLevel: 'beginner',
        lessonSlug: 'interviews-beginner-01-answer-directly',
        lessonPosition: 1,
        checkpoint: false,
      },
    }
    mocks.lessonAccess.mockResolvedValue({
      status: 'allowed',
      data: {
        session: {
          ...payload.curriculum,
          promptId: PROMPT_ID,
          promptText: payload.promptText,
          mode: 'interview',
          difficulty: 'beginner',
          targetDurationSeconds: 60,
        },
        lesson: {},
      },
    })
    const existing = readQuery({ data: null, error: null })
    const insert = insertQuery({ data: storedRow('uploading'), error: null })
    const admin = adminFrom(existing, insert)

    const result = await ensureAttemptCreation({
      admin: admin as never,
      userId: USER_ID,
      payload,
      intent: 'uploading',
    })

    expect(result).toMatchObject({ status: 'ready', value: { created: true } })
    expect(mocks.lessonAccess).toHaveBeenCalledWith(
      admin,
      USER_ID,
      'interviews',
      'interviews-beginner-01-answer-directly',
    )
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        lesson_id: LESSON_ID,
        prompt_id: PROMPT_ID,
        prompt_text: payload.promptText,
        retry_of_attempt_id: null,
        metrics: expect.objectContaining({
          creation: expect.objectContaining({
            curriculum: {
              lesson_id: LESSON_ID,
              path_slug: 'interviews',
              chapter_level: 'beginner',
              lesson_slug: 'interviews-beginner-01-answer-directly',
              lesson_position: 1,
              checkpoint: false,
            },
          }),
        }),
      }),
    )
  })

  it.each([
    ['locked', { status: 'denied', reason: 'locked' }],
    ['inactive', { status: 'denied', reason: 'inactive' }],
    ['wrong path', { status: 'denied', reason: 'path_mismatch' }],
  ] as const)('does not create a structured attempt when the lesson is %s', async (_label, access) => {
    const payload: CreateAttemptPayload = {
      ...PAYLOAD,
      promptId: PROMPT_ID,
      promptText: 'Describe a choice you made recently.',
      mode: 'interview',
      source: 'library',
      additionalContext: undefined,
      targetDurationSeconds: 60,
      curriculum: {
        lessonId: LESSON_ID,
        pathSlug: 'interviews',
        chapterLevel: 'beginner',
        lessonSlug: 'interviews-beginner-01-answer-directly',
        lessonPosition: 1,
        checkpoint: false,
      },
    }
    mocks.lessonAccess.mockResolvedValue(access)
    const existing = readQuery({ data: null, error: null })
    const admin = adminFrom(existing)

    await expect(
      ensureAttemptCreation({ admin: admin as never, userId: USER_ID, payload, intent: 'uploading' }),
    ).resolves.toEqual({ status: 'unavailable' })
    expect(admin.from).toHaveBeenCalledOnce()
  })

  it('fails a structured creation when authoritative curriculum data cannot be read', async () => {
    const payload: CreateAttemptPayload = {
      ...PAYLOAD,
      promptId: PROMPT_ID,
      source: 'library',
      additionalContext: undefined,
      curriculum: {
        lessonId: LESSON_ID,
        pathSlug: 'interviews',
        chapterLevel: 'beginner',
        lessonSlug: 'interviews-beginner-01-answer-directly',
        lessonPosition: 1,
        checkpoint: false,
      },
    }
    mocks.lessonAccess.mockResolvedValue({ status: 'failure', reason: 'query', operation: 'path' })
    const admin = adminFrom(readQuery({ data: null, error: null }))

    await expect(
      ensureAttemptCreation({ admin: admin as never, userId: USER_ID, payload, intent: 'uploading' }),
    ).resolves.toEqual({ status: 'failure' })
  })

  it('inherits a structured retry only from an owned parent for the same lesson', async () => {
    const payload: CreateAttemptPayload = {
      ...PAYLOAD,
      promptId: PROMPT_ID,
      promptText: 'Describe a choice you made recently.',
      mode: 'interview',
      source: 'library',
      additionalContext: undefined,
      targetDurationSeconds: 60,
      retryOfAttemptId: OTHER_ATTEMPT_ID,
      curriculum: {
        lessonId: LESSON_ID,
        pathSlug: 'interviews',
        chapterLevel: 'beginner',
        lessonSlug: 'interviews-beginner-01-answer-directly',
        lessonPosition: 1,
        checkpoint: false,
      },
    }
    mocks.lessonAccess.mockResolvedValue({
      status: 'allowed',
      data: {
        session: {
          ...payload.curriculum,
          promptId: PROMPT_ID,
          promptText: payload.promptText,
          mode: 'interview',
          difficulty: 'beginner',
          targetDurationSeconds: 60,
        },
        lesson: {},
      },
    })
    const existing = readQuery({ data: null, error: null })
    const parent = readQuery({
      data: {
        id: OTHER_ATTEMPT_ID,
        prompt_id: PROMPT_ID,
        lesson_id: LESSON_ID,
        prompt_text: payload.promptText,
        practice_mode: 'interview',
        prompt_source: 'library',
        prompt_difficulty: 'beginner',
        metrics: { practice: { target_duration_seconds: 60 } },
        status: 'done',
      },
      error: null,
    })
    const insert = insertQuery({ data: storedRow('uploading'), error: null })
    const admin = adminFrom(existing, parent, insert)

    const result = await ensureAttemptCreation({
      admin: admin as never,
      userId: USER_ID,
      payload,
      intent: 'uploading',
    })

    expect(result).toMatchObject({ status: 'ready', value: { created: true } })
    expect(parent.select).toHaveBeenCalledWith(
      'id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source, prompt_difficulty, metrics, status',
    )
    expect(parent.eq.mock.calls).toEqual([
      ['id', OTHER_ATTEMPT_ID],
      ['user_id', USER_ID],
    ])
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ lesson_id: LESSON_ID, retry_of_attempt_id: OTHER_ATTEMPT_ID }),
    )
  })

  it('rejects a structured retry parent from a different lesson', async () => {
    const payload: CreateAttemptPayload = {
      ...PAYLOAD,
      promptId: PROMPT_ID,
      promptText: 'Describe a choice you made recently.',
      mode: 'interview',
      source: 'library',
      additionalContext: undefined,
      targetDurationSeconds: 60,
      retryOfAttemptId: OTHER_ATTEMPT_ID,
      curriculum: {
        lessonId: LESSON_ID,
        pathSlug: 'interviews',
        chapterLevel: 'beginner',
        lessonSlug: 'interviews-beginner-01-answer-directly',
        lessonPosition: 1,
        checkpoint: false,
      },
    }
    mocks.lessonAccess.mockResolvedValue({
      status: 'allowed',
      data: {
        session: {
          ...payload.curriculum,
          promptId: PROMPT_ID,
          promptText: payload.promptText,
          mode: 'interview',
          difficulty: 'beginner',
          targetDurationSeconds: 60,
        },
        lesson: {},
      },
    })
    const existing = readQuery({ data: null, error: null })
    const parent = readQuery({
      data: {
        id: OTHER_ATTEMPT_ID,
        prompt_id: PROMPT_ID,
        lesson_id: '60000000-0000-4000-8000-000000000006',
        prompt_text: payload.promptText,
        practice_mode: 'interview',
        prompt_source: 'library',
        prompt_difficulty: 'beginner',
        metrics: { practice: { target_duration_seconds: 60 } },
        status: 'done',
      },
      error: null,
    })
    const admin = adminFrom(existing, parent)

    await expect(
      ensureAttemptCreation({ admin: admin as never, userId: USER_ID, payload, intent: 'uploading' }),
    ).resolves.toEqual({ status: 'unavailable' })
    expect(admin.from).toHaveBeenCalledTimes(2)
  })

  it('rejects a curriculum-only prompt at the authoritative library boundary', async () => {
    const payload: CreateAttemptPayload = {
      ...PAYLOAD,
      promptId: PROMPT_ID,
      promptText: 'Forged curriculum prompt copy.',
      mode: 'practice',
      difficulty: 'beginner',
      source: 'library',
      additionalContext: undefined,
    }
    const existing = readQuery({ data: null, error: null })
    const prompt = readQuery({
      data: {
        id: PROMPT_ID,
        text: 'Curriculum-only prompt.',
        active: true,
        mode: 'practice',
        difficulty: 'beginner',
        target_duration_seconds: 30,
        collection_id: null,
        free_practice_visible: false,
      },
      error: null,
    })
    const admin = adminFrom(existing, prompt)

    await expect(
      ensureAttemptCreation({
        admin: admin as never,
        userId: USER_ID,
        payload,
        intent: 'uploading',
      }),
    ).resolves.toEqual({ status: 'unavailable' })
    expect(prompt.select).toHaveBeenCalledWith(
      'id, text, active, mode, difficulty, target_duration_seconds, collection_id, free_practice_visible',
    )
    expect(prompt.eq.mock.calls).toEqual([
      ['id', PROMPT_ID],
      ['active', true],
      ['free_practice_visible', true],
    ])
    expect(admin.from).toHaveBeenCalledTimes(2)
  })

  it('lets abandonment win first with a server id and a recoverable exact pointer', async () => {
    const inserted = storedRow('failed', ATTEMPT_FAILURE_CODES.clientUploadAbandoned)
    const existing = readQuery({ data: null, error: null })
    const insert = insertQuery({ data: inserted, error: null })
    const admin = adminFrom(existing, insert)

    const result = await ensureAttemptCreation({
      admin: admin as never,
      userId: USER_ID,
      payload: PAYLOAD,
      intent: 'abandoned',
    })

    expect(result).toEqual({
      status: 'ready',
      value: {
        attemptId: ATTEMPT_ID,
        storagePath: `${USER_ID}/${ATTEMPT_ID}.webm`,
        status: 'failed',
        failureCode: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
        created: true,
      },
    })
    expect(insert.insert).toHaveBeenCalledOnce()
    expect(insert.insert.mock.calls[0]?.[0]).toMatchObject({
      id: ATTEMPT_ID,
      user_id: USER_ID,
      lesson_id: null,
      client_request_id: REQUEST_ID,
      audio_path: `${USER_ID}/${ATTEMPT_ID}.webm`,
      status: 'failed',
      failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
      metrics: {
        upload: {
          storage_path: `${USER_ID}/${ATTEMPT_ID}.webm`,
          mime_type: MIME_TYPE,
        },
      },
    })
    expect(insert.insert.mock.calls[0]?.[0]).toHaveProperty('finished_at')
  })

  it('lets normal creation win first, then terminalizes the exact unprocessed row', async () => {
    const existing = readQuery({ data: storedRow('uploading'), error: null })
    const update = updateQuery({ data: { id: ATTEMPT_ID }, error: null })
    const admin = adminFrom(existing, update)

    const ensured = await ensureAttemptCreation({
      admin: admin as never,
      userId: USER_ID,
      payload: PAYLOAD,
      intent: 'abandoned',
      expectedAttemptId: ATTEMPT_ID,
    })
    if (ensured.status !== 'ready') throw new Error('expected an existing attempt')
    const result = await abandonEnsuredAttempt(admin as never, USER_ID, ensured.value)

    expect(result).toEqual({ status: 'ready', abandoned: true })
    expect(update.update).toHaveBeenCalledWith({
      status: 'failed',
      failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned,
      audio_path: `${USER_ID}/${ATTEMPT_ID}.webm`,
    })
    expect(update.eq.mock.calls).toEqual([
      ['id', ATTEMPT_ID],
      ['user_id', USER_ID],
    ])
    expect(update.in).toHaveBeenCalledWith('status', ['uploading', 'transcribing'])
    expect(update.is).toHaveBeenCalledWith('transcript', null)
  })

  it('refuses an attempt id that does not belong to the client request snapshot', async () => {
    const existing = readQuery({ data: storedRow('uploading'), error: null })
    const admin = adminFrom(existing)

    await expect(
      ensureAttemptCreation({
        admin: admin as never,
        userId: USER_ID,
        payload: PAYLOAD,
        intent: 'abandoned',
        expectedAttemptId: OTHER_ATTEMPT_ID,
      }),
    ).resolves.toEqual({ status: 'conflict' })
    expect(admin.from).toHaveBeenCalledOnce()
  })

  it('never creates a browser-specified id when that row is absent', async () => {
    const existing = readQuery({ data: null, error: null })
    const admin = adminFrom(existing)

    await expect(
      ensureAttemptCreation({
        admin: admin as never,
        userId: USER_ID,
        payload: PAYLOAD,
        intent: 'abandoned',
        expectedAttemptId: OTHER_ATTEMPT_ID,
      }),
    ).resolves.toEqual({ status: 'conflict' })
    expect(admin.from).toHaveBeenCalledOnce()
  })

  it('rejects normal creation when abandonment already reserved the request key', async () => {
    const existing = readQuery({
      data: storedRow('failed', ATTEMPT_FAILURE_CODES.clientUploadAbandoned),
      error: null,
    })
    const admin = adminFrom(existing)

    await expect(
      ensureAttemptCreation({
        admin: admin as never,
        userId: USER_ID,
        payload: PAYLOAD,
        intent: 'uploading',
      }),
    ).resolves.toEqual({ status: 'abandoned' })
  })

  it('re-reads the one authoritative row when abandonment loses an insert race', async () => {
    const firstRead = readQuery({ data: null, error: null })
    const insert = insertQuery({ data: null, error: { code: '23505' } })
    const racedRead = readQuery({ data: storedRow('uploading'), error: null })
    const admin = adminFrom(firstRead, insert, racedRead)

    const result = await ensureAttemptCreation({
      admin: admin as never,
      userId: USER_ID,
      payload: PAYLOAD,
      intent: 'abandoned',
    })

    expect(result).toMatchObject({
      status: 'ready',
      value: { attemptId: ATTEMPT_ID, status: 'uploading', created: false },
    })
    expect(racedRead.eq.mock.calls).toEqual([
      ['user_id', USER_ID],
      ['client_request_id', REQUEST_ID],
    ])
  })

  it('re-reads and rejects creation when abandonment wins an insert race', async () => {
    const firstRead = readQuery({ data: null, error: null })
    const insert = insertQuery({ data: null, error: { code: '23505' } })
    const racedRead = readQuery({
      data: storedRow('failed', ATTEMPT_FAILURE_CODES.clientUploadAbandoned),
      error: null,
    })
    const admin = adminFrom(firstRead, insert, racedRead)

    await expect(
      ensureAttemptCreation({
        admin: admin as never,
        userId: USER_ID,
        payload: PAYLOAD,
        intent: 'uploading',
      }),
    ).resolves.toEqual({ status: 'abandoned' })
  })

  it('is idempotent after the row is already abandoned and never deletes data', async () => {
    const existing = readQuery({
      data: storedRow('failed', ATTEMPT_FAILURE_CODES.clientUploadAbandoned),
      error: null,
    })
    const admin = adminFrom(existing)
    const ensured = await ensureAttemptCreation({
      admin: admin as never,
      userId: USER_ID,
      payload: PAYLOAD,
      intent: 'abandoned',
    })
    if (ensured.status !== 'ready') throw new Error('expected an abandoned attempt')

    await expect(abandonEnsuredAttempt(admin as never, USER_ID, ensured.value)).resolves.toEqual({
      status: 'ready',
      abandoned: true,
    })
    expect(admin.from).toHaveBeenCalledOnce()
  })
})
