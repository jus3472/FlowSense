// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  logAttemptDiagnostic: vi.fn(),
  notFound: vi.fn(),
  readAttemptResult: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/attempts/server', () => ({ logAttemptDiagnostic: mocks.logAttemptDiagnostic }))
vi.mock('@/lib/results/attempt-result', () => ({ readAttemptResult: mocks.readAttemptResult }))

vi.mock('@/components/results/results-view', () => ({
  ResultsView: ({ attempt }: { attempt: { audioUrl: string | null } }) => (
    <div data-audio={attempt.audioUrl ?? 'none'} data-testid="legacy-result">
      Legacy result
    </div>
  ),
}))

vi.mock('@/components/results/v2-results-view', () => ({
  V2ResultsView: ({
    audioUrl,
    payload,
    comparison,
    previousAttemptId,
  }: {
    audioUrl: string | null
    payload: { fixture: string }
    comparison?: unknown
    previousAttemptId?: string | null
  }) => (
    <div
      data-audio={audioUrl ?? 'none'}
      data-comparison={comparison ? 'shown' : 'none'}
      data-previous={previousAttemptId ?? 'none'}
      data-testid="v2-result"
    >
      {payload.fixture}
    </div>
  ),
}))

import AttemptPage from '@/app/(app)/attempts/[id]/page'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const PARENT_ID = '20000000-0000-4000-8000-000000000002'
const MISSING_ID = '30000000-0000-4000-8000-000000000003'
const CROSS_USER_ID = '40000000-0000-4000-8000-000000000004'
const USER_ID = '50000000-0000-4000-8000-000000000005'
const PRIVATE_PATH = `${USER_ID}/${ATTEMPT_ID}/private-recording.webm`
const PRIVATE_PROMPT = 'Private prompt text should not be logged.'
const PRIVATE_TRANSCRIPT = 'Private transcript text should not be logged.'
const PRIVATE_ERROR = 'private database and storage error text'
const PRIVATE_SIGNED_URL = 'https://private.example.test/signed-recording'
const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

interface QueryResponse {
  data: Record<string, unknown> | null
  error: unknown
}

interface ClientOptions {
  primary?: QueryResponse
  primaryThrows?: boolean
  ancestor?: QueryResponse
  ancestorThrows?: boolean
  signed?: { data: { signedUrl: string } | null; error: unknown }
  signedThrows?: boolean
  disputes?: { data: Array<Record<string, unknown>>; error: unknown }
  disputesThrow?: boolean
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    prompt_text: PRIVATE_PROMPT,
    transcript: PRIVATE_TRANSCRIPT,
    duration_ms: 20_000,
    audio_path: null,
    created_at: '2026-08-27T12:00:00.000Z',
    score: 80,
    section_scores: 'v2',
    metrics: null,
    content_result: null,
    retry_of_attempt_id: null,
    ...overrides,
  }
}

function resultQuery(options: ClientOptions, filters: Array<{ column: string; value: unknown }>) {
  let selectedId: unknown
  const query = {
    select: vi.fn(),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push({ column, value })
      if (column === 'id') selectedId = value
      return query
    }),
    maybeSingle: vi.fn(async () => {
      const primary =
        selectedId === ATTEMPT_ID || selectedId === MISSING_ID || selectedId === CROSS_USER_ID
      if (primary && options.primaryThrows) throw new Error(PRIVATE_ERROR)
      if (!primary && options.ancestorThrows) throw new Error(PRIVATE_ERROR)
      return primary
        ? (options.primary ?? { data: attempt(), error: null })
        : (options.ancestor ?? { data: null, error: null })
    }),
  }
  query.select.mockReturnValue(query)
  return query
}

function noteFeedbackQuery(
  options: ClientOptions,
  filters: Array<{ column: string; value: unknown }>,
) {
  const result = options.disputes ?? { data: [], error: null }
  const query = {
    select: vi.fn(),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push({ column, value })
      if (column === 'user_id') {
        return options.disputesThrow
          ? Promise.reject(new Error(PRIVATE_ERROR))
          : Promise.resolve(result)
      }
      return query
    }),
  }
  query.select.mockReturnValue(query)
  return query
}

function client(options: ClientOptions = {}) {
  const filters: Array<{ column: string; value: unknown }> = []
  const createSignedUrl = vi.fn(async () => {
    if (options.signedThrows) throw new Error(PRIVATE_ERROR)
    return options.signed ?? { data: { signedUrl: PRIVATE_SIGNED_URL }, error: null }
  })
  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
    from: vi.fn((table: string) =>
      table === 'attempts' ? resultQuery(options, filters) : noteFeedbackQuery(options, filters),
    ),
    storage: {
      from: vi.fn(() => ({ createSignedUrl })),
    },
  }
  return { supabase, filters, createSignedUrl }
}

async function renderPage(id = ATTEMPT_ID) {
  render(await AttemptPage({ params: Promise.resolve({ id }) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.notFound.mockImplementation(() => {
    throw NOT_FOUND
  })
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirect')
  })
  mocks.readAttemptResult.mockImplementation(
    (input: { sectionScores: unknown; audioUrl: string | null }) => {
      if (input.sectionScores === 'legacy') {
        return { kind: 'legacy', attempt: { audioUrl: input.audioUrl } }
      }
      if (input.sectionScores === 'v2-partial') {
        return { kind: 'v2', payload: { fixture: 'Partial v2 result' } }
      }
      return { kind: 'v2', payload: { fixture: 'Complete v2 result' } }
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('owned attempt result loading', () => {
  it.each([
    { label: 'returned query error', options: { primary: { data: null, error: PRIVATE_ERROR } } },
    { label: 'thrown query error', options: { primaryThrows: true } },
  ])('renders a recoverable error for a $label', async ({ options }) => {
    const setup = client(options)
    mocks.createClient.mockResolvedValue(setup.supabase)

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Result unavailable' })).toBeInTheDocument()
    expect(
      screen.getByText('Your result could not be loaded. Try again in a moment.'),
    ).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Try again' })
    fireEvent.click(retry)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(mocks.logAttemptDiagnostic).toHaveBeenCalledExactlyOnceWith(
      'load_attempt_result',
      'attempt_result_read_failed',
      null,
    )
  })

  it.each([
    { label: 'missing', id: MISSING_ID },
    { label: 'owned by another user', id: CROSS_USER_ID },
  ])('uses the same not-found boundary for a $label attempt', async ({ id }) => {
    const setup = client({ primary: { data: null, error: null } })
    mocks.createClient.mockResolvedValue(setup.supabase)

    await expect(AttemptPage({ params: Promise.resolve({ id }) })).rejects.toBe(NOT_FOUND)

    expect(mocks.logAttemptDiagnostic).not.toHaveBeenCalled()
    expect(setup.filters).toContainEqual({ column: 'id', value: id })
    expect(setup.filters).toContainEqual({ column: 'user_id', value: USER_ID })
  })

  it.each([
    { snapshot: 'legacy', testId: 'legacy-result', label: 'Legacy result' },
    { snapshot: 'v2', testId: 'v2-result', label: 'Complete v2 result' },
    { snapshot: 'v2-partial', testId: 'v2-result', label: 'Partial v2 result' },
  ])('renders an owned $snapshot snapshot without audio', async ({ snapshot, testId, label }) => {
    const setup = client({
      primary: { data: attempt({ section_scores: snapshot, audio_path: null }), error: null },
    })
    mocks.createClient.mockResolvedValue(setup.supabase)

    await renderPage()

    expect(screen.getByTestId(testId)).toHaveTextContent(label)
    expect(screen.getByTestId(testId)).toHaveAttribute('data-audio', 'none')
    expect(setup.createSignedUrl).not.toHaveBeenCalled()
    expect(mocks.logAttemptDiagnostic).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'returned signing error',
      snapshot: 'v2',
      testId: 'v2-result',
      resultLabel: 'Complete v2 result',
      options: { signed: { data: null, error: PRIVATE_ERROR } },
    },
    {
      label: 'empty signing response',
      snapshot: 'v2-partial',
      testId: 'v2-result',
      resultLabel: 'Partial v2 result',
      options: { signed: { data: null, error: null } },
    },
    {
      label: 'thrown signing error',
      snapshot: 'legacy',
      testId: 'legacy-result',
      resultLabel: 'Legacy result',
      options: { signedThrows: true },
    },
  ])('renders the $snapshot result without audio after a $label', async (testCase) => {
    const setup = client({
      ...testCase.options,
      primary: {
        data: attempt({ audio_path: PRIVATE_PATH, section_scores: testCase.snapshot }),
        error: null,
      },
    })
    mocks.createClient.mockResolvedValue(setup.supabase)

    await renderPage()

    expect(screen.getByTestId(testCase.testId)).toHaveTextContent(testCase.resultLabel)
    expect(screen.getByTestId(testCase.testId)).toHaveAttribute('data-audio', 'none')
    expect(screen.getByText('Audio playback is unavailable for this response.')).toBeInTheDocument()
    expect(mocks.logAttemptDiagnostic).toHaveBeenCalledExactlyOnceWith(
      'sign_attempt_result_audio',
      'signed_audio_url_failed',
      null,
    )
    const diagnostic = JSON.stringify(mocks.logAttemptDiagnostic.mock.calls)
    for (const privateValue of [
      PRIVATE_PATH,
      PRIVATE_PROMPT,
      PRIVATE_TRANSCRIPT,
      PRIVATE_ERROR,
      PRIVATE_SIGNED_URL,
    ]) {
      expect(diagnostic).not.toContain(privateValue)
    }
  })

  it.each([
    {
      label: 'returned dispute error',
      options: { disputes: { data: [], error: PRIVATE_ERROR } },
    },
    { label: 'thrown dispute error', options: { disputesThrow: true } },
  ])('renders a recoverable error after a $label', async ({ options }) => {
    const setup = client({
      ...options,
      primary: { data: attempt({ section_scores: 'legacy' }), error: null },
    })
    mocks.createClient.mockResolvedValue(setup.supabase)

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Result unavailable' })).toBeInTheDocument()
    expect(screen.queryByTestId('legacy-result')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(mocks.logAttemptDiagnostic).toHaveBeenCalledExactlyOnceWith(
      'load_result_disputes',
      'result_disputes_read_failed',
      null,
    )
    expect(setup.filters).toContainEqual({ column: 'attempt_id', value: ATTEMPT_ID })
    expect(setup.filters.filter((filter) => filter.column === 'user_id')).toEqual([
      { column: 'user_id', value: USER_ID },
      { column: 'user_id', value: USER_ID },
    ])
    expect(JSON.stringify(mocks.logAttemptDiagnostic.mock.calls)).not.toContain(PRIVATE_ERROR)
  })

  it.each([
    {
      label: 'returned ancestor error',
      options: { ancestor: { data: null, error: PRIVATE_ERROR } },
    },
    { label: 'thrown ancestor error', options: { ancestorThrows: true } },
  ])('suppresses retry navigation after a $label', async ({ options }) => {
    const setup = client({
      ...options,
      primary: {
        data: attempt({ retry_of_attempt_id: PARENT_ID }),
        error: null,
      },
    })
    mocks.createClient.mockResolvedValue(setup.supabase)

    await renderPage()

    expect(screen.getByTestId('v2-result')).toHaveAttribute('data-previous', 'none')
    expect(screen.getByTestId('v2-result')).toHaveAttribute('data-comparison', 'none')
    expect(mocks.logAttemptDiagnostic).toHaveBeenCalledExactlyOnceWith(
      'load_retry_ancestor',
      'retry_ancestor_read_failed',
      null,
    )
    expect(setup.filters).toContainEqual({ column: 'id', value: PARENT_ID })
    expect(setup.filters.filter((filter) => filter.column === 'user_id')).toEqual([
      { column: 'user_id', value: USER_ID },
      { column: 'user_id', value: USER_ID },
    ])
  })
})
