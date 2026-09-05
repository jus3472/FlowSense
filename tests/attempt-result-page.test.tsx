// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), loadLessonAttemptHistoryForUser: vi.fn(),
  loadStructuredLessonResultForUser: vi.fn(), logAttemptDiagnostic: vi.fn(),
  notFound: vi.fn(), readAttemptResult: vi.fn(), storedTranscriptWords: vi.fn(),
  reconcileCurrentUserStaleAttempts: vi.fn(), redirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/attempts/server', () => ({ logAttemptDiagnostic: mocks.logAttemptDiagnostic }))
vi.mock('@/lib/attempts/reconciliation', () => ({ reconcileCurrentUserStaleAttempts: mocks.reconcileCurrentUserStaleAttempts }))
vi.mock('@/lib/results/attempt-result', () => ({ readAttemptResult: mocks.readAttemptResult, storedTranscriptWords: mocks.storedTranscriptWords }))
vi.mock('@/lib/curriculum/result-server', () => ({ loadStructuredLessonResultForUser: mocks.loadStructuredLessonResultForUser }))
vi.mock('@/lib/results/lesson-attempt-history', () => ({ loadLessonAttemptHistoryForUser: mocks.loadLessonAttemptHistoryForUser }))
vi.mock('@/components/results/v3-results-view', () => ({
  V3ResultsView: ({ payload, previousAttempts }: { payload: { fixture: string }; previousAttempts: readonly { attemptId: string }[] }) => (
    <div data-history={previousAttempts.map((item) => item.attemptId).join(',')} data-testid="v3-result">{payload.fixture}</div>
  ),
}))
vi.mock('@/components/record/audio-player', () => ({ AudioPlayer: ({ src }: { src: string }) => <div data-testid="audio">{src}</div> }))

import AttemptPage from '@/app/(app)/attempts/[id]/page'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '50000000-0000-4000-8000-000000000005'

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID, prompt_id: null, lesson_id: null,
    prompt_text: 'Describe a clear decision.', transcript: 'I chose the first option because it was simpler.',
    duration_ms: 12_000, audio_path: null, created_at: '2026-09-01T12:00:00.000Z',
    score: 80, section_scores: { version: 'v3.score.2' }, metrics: null, content_result: null,
    practice_mode: 'practice', rubric_version: 'v3', retry_of_attempt_id: null,
    status: 'done', failure_code: null, ...overrides,
  }
}

function clientFor(row: ReturnType<typeof attempt>) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn().mockReturnValue(query),
    storage: { from: vi.fn().mockReturnValue({ createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://audio.test' }, error: null }) }) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.notFound.mockImplementation(() => { throw new Error('not found') })
  mocks.redirect.mockImplementation(() => { throw new Error('redirect') })
  mocks.reconcileCurrentUserStaleAttempts.mockResolvedValue({ status: 'ready', reconciled: [] })
  mocks.loadLessonAttemptHistoryForUser.mockResolvedValue({ status: 'ready', data: [] })
  mocks.loadStructuredLessonResultForUser.mockResolvedValue({ status: 'not_found' })
  mocks.storedTranscriptWords.mockReturnValue([])
})

describe('attempt result page', () => {
  it('rejects a malformed route id before loading storage', async () => {
    await expect(AttemptPage({ params: Promise.resolve({ id: 'bad' }) })).rejects.toThrow('not found')
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('renders an exact current result and structured lesson history', async () => {
    const row = attempt({ lesson_id: '70000000-0000-4000-8000-000000000007' })
    mocks.createClient.mockResolvedValue(clientFor(row))
    mocks.readAttemptResult.mockReturnValue({ kind: 'v3', payload: { fixture: 'Current result', mode: 'practice', rubric_version: 'v3', total_earned_points: 80 } })
    mocks.loadLessonAttemptHistoryForUser.mockResolvedValue({ status: 'ready', data: [{ attemptId: 'prior', score: 70, finishedAt: '2026-08-01T00:00:00Z' }] })
    render(await AttemptPage({ params: Promise.resolve({ id: ATTEMPT_ID }) }))
    expect(screen.getByTestId('v3-result')).toHaveTextContent('Current result')
    expect(screen.getByTestId('v3-result')).toHaveAttribute('data-history', 'prior')
  })

  it.each(['failed', 'timed_out'] as const)('keeps a resultless %s recording playable and retryable', async (status) => {
    const row = attempt({ status, score: null, section_scores: null, audio_path: `${USER_ID}/${ATTEMPT_ID}.webm` })
    mocks.createClient.mockResolvedValue(clientFor(row))
    mocks.readAttemptResult.mockReturnValue({ kind: 'incomplete' })
    render(await AttemptPage({ params: Promise.resolve({ id: ATTEMPT_ID }) }))
    expect(screen.getByText('Not scored yet')).toBeInTheDocument()
    expect(screen.getByTestId('audio')).toHaveTextContent('https://audio.test')
    expect(screen.getByRole('link', { name: 'Try this prompt again' })).toHaveAttribute('href', `/record?retry=${ATTEMPT_ID}`)
  })

  it.each(['unsupported_version', 'malformed'] as const)('shows a safe unavailable state for %s results', async (kind) => {
    const row = attempt()
    mocks.createClient.mockResolvedValue(clientFor(row))
    mocks.readAttemptResult.mockReturnValue({ kind, scoreVersion: 'old.score.1', rubricVersion: 'old' })
    render(await AttemptPage({ params: Promise.resolve({ id: ATTEMPT_ID }) }))
    expect(screen.getByText('Result unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('v3-result')).not.toBeInTheDocument()
  })
})
