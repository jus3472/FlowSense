import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assembleV3Score: vi.fn(), authenticatedAttemptContext: vi.fn(), evaluateAudioMetrics: vi.fn(),
  isV3ScorePayload: vi.fn(), markOwnedAttemptFailure: vi.fn(), recordPracticeActivityDay: vi.fn(),
  runV3ContentEvaluation: vi.fn(), transitionOwnedAttempt: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/activity/server', () => ({ recordPracticeActivityDay: mocks.recordPracticeActivityDay }))
vi.mock('@/lib/attempts/server', () => ({
  authenticatedAttemptContext: mocks.authenticatedAttemptContext,
  logAttemptDiagnostic: vi.fn(),
  markOwnedAttemptFailure: mocks.markOwnedAttemptFailure,
  transitionOwnedAttempt: mocks.transitionOwnedAttempt,
}))
vi.mock('@/lib/deepseek/provider', () => ({
  DEEPSEEK_MODEL: 'deepseek-v4-flash', createDeepSeekModel: vi.fn(() => ({ name: 'deepseek', complete: vi.fn() })),
  reportContentProviderFailure: vi.fn((error: unknown) => error),
}))
vi.mock('@/lib/env/server', () => ({ deepseekApiKey: vi.fn(() => 'test-key') }))
vi.mock('@/lib/scoring/v3/assemble', () => ({ assembleV3Score: mocks.assembleV3Score, isV3ScorePayload: mocks.isV3ScorePayload }))
vi.mock('@/lib/scoring/v3/audio', () => ({ evaluateAudioMetrics: mocks.evaluateAudioMetrics }))
vi.mock('@/lib/scoring/v3/content/evaluate', () => ({ runV3ContentEvaluation: mocks.runV3ContentEvaluation }))

import { POST } from '@/app/api/score/route'
import { ATTEMPT_FAILURE_CODES } from '@/lib/attempts/lifecycle'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const V3_CONTENT = { version: 'v3.content-evaluator.1', provider: 'deepseek', status: 'checked', metrics: {}, warnings: [], calls: 1 }
const V3_SCORE = { version: 'v3.score.2', rubric_version: 'v3', mode: 'practice', total_earned_points: 74, total_max_points: 100, sections: {}, recommendation: null, warnings: [] }
const metric = (id: string) => ({ id, status: 'scored', component: 0.8, explanation: `Measured ${id}.`, measurements: {}, evidence: [], deductions: [], warnings: [] })
const V3_AUDIO = { version: 'v3.audio.4', mode: 'practice', metrics: { pace: metric('pace'), paused_time: metric('paused_time'), articulation: metric('articulation'), energy: metric('energy') }, warnings: [] }

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID, prompt_text: 'Private prompt', audio_path: null, transcript: 'A complete response.', duration_ms: 20_000,
    metrics: { capture: { duration_ms: 20_000, sample_interval_ms: 50, amplitude: [], pitch: [] }, transcript: { words: [] } },
    score: null, section_scores: null, content_result: null, practice_mode: 'practice', rubric_version: 'v3', status: 'scoring',
    failure_code: null, created_at: '2026-08-27T12:00:00.000Z', ...overrides,
  }
}

function adminClient(initial: Record<string, unknown>, concurrent: Record<string, unknown> | null = null) {
  const reads = [{ data: initial, error: null }, { data: concurrent, error: null }]
  const attempts = {
    select: vi.fn(() => {
      const response = reads.shift() ?? { data: null, error: null }
      const query = { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(response) }
      return query
    }),
  }
  return { from: vi.fn(() => attempts), storage: { from: vi.fn(() => ({ download: vi.fn() })) } }
}

function request() {
  return new Request('http://localhost/api/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attemptId: ATTEMPT_ID }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isV3ScorePayload.mockReturnValue(false)
  mocks.markOwnedAttemptFailure.mockResolvedValue(undefined)
  mocks.transitionOwnedAttempt.mockResolvedValue(true)
  mocks.recordPracticeActivityDay.mockResolvedValue({ status: 'recorded' })
  mocks.runV3ContentEvaluation.mockResolvedValue(V3_CONTENT)
  mocks.evaluateAudioMetrics.mockReturnValue(V3_AUDIO)
  mocks.assembleV3Score.mockReturnValue(V3_SCORE)
})

describe('score route current-generation integrity', () => {
  it('returns an exact stored current snapshot without evaluating or mutating it', async () => {
    const admin = adminClient(attempt({ status: 'done', score: 74, section_scores: V3_SCORE, content_result: V3_CONTENT }))
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    mocks.isV3ScorePayload.mockReturnValue(true)
    const response = await POST(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ score: 74, section_scores: V3_SCORE })
    expect(mocks.runV3ContentEvaluation).not.toHaveBeenCalled()
    expect(mocks.transitionOwnedAttempt).not.toHaveBeenCalled()
  })

  it.each([
    ['v2', { version: 'v2.score.1', rubric_version: 'v2' }],
    ['v3.1', { version: 'v3.score.1', rubric_version: 'v3' }],
    ['future', { version: 'v4.score.1', rubric_version: 'v4' }],
    ['malformed current', { version: 'v3.score.2', rubric_version: 'v3' }],
  ])('rejects a done %s snapshot without mutation', async (_label, sectionScores) => {
    const admin = adminClient(attempt({ status: 'done', score: 80, section_scores: sectionScores }))
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(mocks.runV3ContentEvaluation).not.toHaveBeenCalled()
    expect(mocks.transitionOwnedAttempt).not.toHaveBeenCalled()
    expect(mocks.markOwnedAttemptFailure).not.toHaveBeenCalled()
  })

  it.each([
    ['score mismatch', { score: 73, practice_mode: 'practice' }],
    ['mode mismatch', { score: 74, practice_mode: 'interview' }],
  ])('rejects a structurally current done snapshot with a row %s', async (_label, overrides) => {
    const admin = adminClient(attempt({ status: 'done', section_scores: V3_SCORE, ...overrides }))
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    mocks.isV3ScorePayload.mockReturnValue(true)
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(mocks.runV3ContentEvaluation).not.toHaveBeenCalled()
    expect(mocks.transitionOwnedAttempt).not.toHaveBeenCalled()
  })

  it('scores and persists an active current attempt', async () => {
    const admin = adminClient(attempt())
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.runV3ContentEvaluation).toHaveBeenCalledOnce()
    expect(mocks.evaluateAudioMetrics).toHaveBeenCalledOnce()
    expect(mocks.assembleV3Score).toHaveBeenCalledOnce()
    expect(mocks.transitionOwnedAttempt).toHaveBeenCalledWith(admin, USER_ID, ATTEMPT_ID, ['scoring'], 'done', expect.objectContaining({ score: 74, section_scores: V3_SCORE }))
  })

  it('persists a provider-neutral current result without inventing a score', async () => {
    const neutral = { ...V3_SCORE, total_earned_points: null }
    mocks.assembleV3Score.mockReturnValue(neutral)
    const admin = adminClient(attempt())
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.transitionOwnedAttempt).toHaveBeenCalledWith(admin, USER_ID, ATTEMPT_ID, ['scoring'], 'done', expect.objectContaining({ score: null, section_scores: neutral }))
  })

  it('fails closed and marks an active non-v3 attempt without provider work', async () => {
    const admin = adminClient(attempt({ rubric_version: 'v2' }))
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(mocks.markOwnedAttemptFailure).toHaveBeenCalledWith(admin, USER_ID, ATTEMPT_ID, ['scoring'], 'failed', ATTEMPT_FAILURE_CODES.unsupportedRubricVersion)
    expect(mocks.runV3ContentEvaluation).not.toHaveBeenCalled()
  })

  it.each([
    ['capture', { metrics: { transcript: { words: [] } } }],
    ['transcript', { transcript: '   ' }],
  ])('rejects a current attempt missing %s input', async (_label, overrides) => {
    const admin = adminClient(attempt(overrides))
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(mocks.markOwnedAttemptFailure).toHaveBeenCalled()
    expect(mocks.runV3ContentEvaluation).not.toHaveBeenCalled()
  })

  it('resumes a resultless terminal attempt through the current scoring path', async () => {
    const admin = adminClient(attempt({ status: 'timed_out', score: null, section_scores: null }))
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.transitionOwnedAttempt).toHaveBeenNthCalledWith(1, admin, USER_ID, ATTEMPT_ID, ['timed_out'], 'scoring')
  })

  it('rejects an abandoned terminal upload before scoring', async () => {
    const admin = adminClient(attempt({ status: 'failed', failure_code: ATTEMPT_FAILURE_CODES.clientUploadAbandoned }))
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(mocks.runV3ContentEvaluation).not.toHaveBeenCalled()
  })

  it('returns a concurrently saved exact current snapshot without overwriting it', async () => {
    const admin = adminClient(attempt(), { score: 74, section_scores: V3_SCORE, content_result: V3_CONTENT })
    mocks.authenticatedAttemptContext.mockResolvedValue({ userId: USER_ID, admin })
    mocks.isV3ScorePayload.mockReturnValueOnce(false).mockReturnValueOnce(true)
    mocks.transitionOwnedAttempt.mockResolvedValueOnce(false)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.markOwnedAttemptFailure).not.toHaveBeenCalled()
  })
})
