// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getPromptById: vi.fn(),
  getRecentCompletedLibraryPromptIds: vi.fn(),
  pickRecordPrompt: vi.fn(),
  reconcileCurrentUserStaleAttempts: vi.fn(),
  recordFlow: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({
  default: function MockLink({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: vi.fn(() => null) })),
}))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('@/components/record/record-flow', () => ({
  RecordFlow: ({ session }: { session: unknown }) => {
    mocks.recordFlow(session)
    return <div data-testid="record-flow">Recorder</div>
  },
}))
vi.mock('@/lib/prompts/server', () => ({
  getPromptById: mocks.getPromptById,
  getRecentCompletedLibraryPromptIds: mocks.getRecentCompletedLibraryPromptIds,
  pickRecordPrompt: mocks.pickRecordPrompt,
}))
vi.mock('@/lib/attempts/reconciliation', () => ({
  reconcileCurrentUserStaleAttempts: mocks.reconcileCurrentUserStaleAttempts,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import RecordPage from '@/app/(app)/record/page'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const PROMPT_ID = '30000000-0000-4000-8000-000000000003'
const PRIVATE_ERROR = 'private database prompt and transcript text'

interface RetryResponse {
  data: Record<string, unknown> | null
  error: unknown
}

interface QueryOperation {
  method: string
  args: unknown[]
}

interface ClientSetup {
  client: ReturnType<typeof createFakeClient>
  retryOperations: QueryOperation[]
  retryRead: ReturnType<typeof vi.fn>
}

function retryAttempt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ATTEMPT_ID,
    prompt_id: PROMPT_ID,
    prompt_text: 'Describe a choice you made recently.',
    practice_mode: 'interview',
    prompt_source: 'library',
    prompt_difficulty: 'advanced',
    metrics: { practice: { target_duration_seconds: 45 } },
    status: 'done',
    ...overrides,
  }
}

function createFakeClient(
  retryResponse: RetryResponse = { data: retryAttempt(), error: null },
  retryThrows = false,
) {
  const retryOperations: QueryOperation[] = []
  const retryQuery = {
    select: vi.fn((...args: unknown[]) => {
      retryOperations.push({ method: 'select', args })
      return retryQuery
    }),
    eq: vi.fn((...args: unknown[]) => {
      retryOperations.push({ method: 'eq', args })
      return retryQuery
    }),
    maybeSingle: vi.fn(async () => {
      if (retryThrows) {
        throw Object.assign(new Error(PRIVATE_ERROR), { code: 'NETWORK_ERROR' })
      }
      return retryResponse
    }),
  }
  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: { focus_areas: [] }, error: null })),
  }
  profileQuery.select.mockReturnValue(profileQuery)
  profileQuery.eq.mockReturnValue(profileQuery)

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
    from: vi.fn((table: string) => (table === 'attempts' ? retryQuery : profileQuery)),
    retryOperations,
    retryRead: retryQuery.maybeSingle,
  }
}

function useClient(
  retryResponse: RetryResponse = { data: retryAttempt(), error: null },
  retryThrows = false,
): ClientSetup {
  const client = createFakeClient(retryResponse, retryThrows)
  mocks.createClient.mockResolvedValue(client)
  return {
    client,
    retryOperations: client.retryOperations,
    retryRead: client.retryRead,
  }
}

async function renderPage(params: {
  retry?: string | string[]
  prompt?: string | string[]
  custom?: string | string[]
  mode?: string | string[]
}) {
  render(await RecordPage({ searchParams: Promise.resolve(params) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reconcileCurrentUserStaleAttempts.mockResolvedValue({ status: 'ready', reconciled: [] })
  mocks.getPromptById.mockResolvedValue({ status: 'empty' })
  mocks.getRecentCompletedLibraryPromptIds.mockResolvedValue({ status: 'empty' })
  mocks.pickRecordPrompt.mockResolvedValue({
    status: 'ready',
    data: {
      id: PROMPT_ID,
      text: 'Describe something nearby.',
      mode: 'practice',
      difficulty: 'beginner',
      targetDurationSeconds: 30,
      collectionId: 'spontaneous_description',
    },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('record retry route boundary', () => {
  it('keeps ordinary fast start when no retry parameter is present', async () => {
    const setup = useClient()

    await renderPage({})

    expect(screen.getByTestId('record-flow')).toBeInTheDocument()
    expect(mocks.pickRecordPrompt).toHaveBeenCalledOnce()
    expect(setup.retryRead).not.toHaveBeenCalled()
    expect(mocks.reconcileCurrentUserStaleAttempts).not.toHaveBeenCalled()
    expect(mocks.recordFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        promptText: 'Describe something nearby.',
        retryOfAttemptId: null,
      }),
    )
  })

  it('restores one valid owned retry descriptor and scopes the lookup', async () => {
    const setup = useClient()

    await renderPage({ retry: ATTEMPT_ID })

    expect(screen.getByTestId('record-flow')).toBeInTheDocument()
    expect(mocks.pickRecordPrompt).not.toHaveBeenCalled()
    expect(mocks.recordFlow).toHaveBeenCalledWith({
      promptText: 'Describe a choice you made recently.',
      promptId: PROMPT_ID,
      mode: 'interview',
      difficulty: 'advanced',
      source: 'library',
      targetDurationSeconds: 45,
      retryOfAttemptId: ATTEMPT_ID,
    })
    expect(setup.retryOperations).toContainEqual({ method: 'eq', args: ['id', ATTEMPT_ID] })
    expect(setup.retryOperations).toContainEqual({ method: 'eq', args: ['user_id', USER_ID] })
    expect(mocks.reconcileCurrentUserStaleAttempts).toHaveBeenCalledWith(USER_ID, {
      attemptId: ATTEMPT_ID,
    })
  })

  it.each([
    ['an empty retry value', ''],
    ['a malformed retry UUID', 'not-a-uuid'],
    ['repeated retry values', [ATTEMPT_ID, ATTEMPT_ID]],
  ])('keeps %s out of random selection', async (_label, retry) => {
    const setup = useClient()

    await renderPage({ retry })

    expect(screen.getByRole('heading', { name: 'That retry is not available' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse practice' })).toHaveAttribute(
      'href',
      '/practice',
    )
    expect(setup.retryRead).not.toHaveBeenCalled()
    expect(mocks.pickRecordPrompt).not.toHaveBeenCalled()
    expect(mocks.recordFlow).not.toHaveBeenCalled()
  })

  it('fails closed for contradictory retry query values', async () => {
    const setup = useClient()

    await renderPage({ retry: ATTEMPT_ID, custom: '1' })

    expect(screen.getByRole('heading', { name: 'That retry is not available' })).toBeInTheDocument()
    expect(setup.retryRead).not.toHaveBeenCalled()
    expect(mocks.pickRecordPrompt).not.toHaveBeenCalled()
  })

  it('does not reveal whether a missing or cross-user retry ID exists', async () => {
    const setup = useClient({ data: null, error: null })

    await renderPage({ retry: ATTEMPT_ID })

    expect(screen.getByRole('heading', { name: 'That retry is not available' })).toBeInTheDocument()
    expect(screen.queryByText(/owner|account|user/i)).not.toBeInTheDocument()
    expect(setup.retryOperations).toContainEqual({ method: 'eq', args: ['user_id', USER_ID] })
    expect(mocks.pickRecordPrompt).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'renders a refresh action for a %s retry query failure and logs bounded metadata',
    async (throws) => {
      const error = { code: 'PGRST500', message: PRIVATE_ERROR, details: PRIVATE_ERROR }
      useClient({ data: null, error }, throws)
      const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      await renderPage({ retry: ATTEMPT_ID })

      expect(screen.getByRole('heading', { name: 'Your retry did not load' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(mocks.refresh).toHaveBeenCalledOnce()
      expect(mocks.pickRecordPrompt).not.toHaveBeenCalled()
      expect(logging).toHaveBeenCalledWith('[practice] session data load failed', {
        operation: 'retry_attempt',
        code: throws ? 'NETWORK_ERROR' : 'PGRST500',
      })
      expect(JSON.stringify(logging.mock.calls)).not.toContain(PRIVATE_ERROR)
    },
  )

  it('retries a library snapshot after its public prompt row is deleted', async () => {
    useClient({
      data: retryAttempt({ prompt_id: null, practice_mode: 'presentation' }),
      error: null,
    })

    await renderPage({ retry: ATTEMPT_ID })

    expect(mocks.recordFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: null,
        source: 'library',
        mode: 'presentation',
        retryOfAttemptId: ATTEMPT_ID,
      }),
    )
    expect(mocks.getPromptById).not.toHaveBeenCalled()
    expect(mocks.pickRecordPrompt).not.toHaveBeenCalled()
  })

  it('blocks an incomplete stored retry descriptor without randomizing', async () => {
    useClient({ data: retryAttempt({ prompt_text: '', practice_mode: 'unknown' }), error: null })

    await renderPage({ retry: ATTEMPT_ID })

    expect(screen.getByRole('heading', { name: 'That retry is not available' })).toBeInTheDocument()
    expect(mocks.pickRecordPrompt).not.toHaveBeenCalled()
    expect(mocks.recordFlow).not.toHaveBeenCalled()
  })

  it('preserves custom prompt context and duration from the private attempt snapshot', async () => {
    useClient({
      data: retryAttempt({
        prompt_id: null,
        prompt_text: 'Explain a decision you made.',
        practice_mode: 'conversation',
        prompt_source: 'custom',
        prompt_difficulty: 'intermediate',
        metrics: {
          practice: {
            target_duration_seconds: 30,
            additional_context: 'Keep the names private.',
          },
        },
      }),
      error: null,
    })

    await renderPage({ retry: ATTEMPT_ID })

    expect(mocks.recordFlow).toHaveBeenCalledWith({
      promptText: 'Explain a decision you made.',
      promptId: null,
      mode: 'conversation',
      difficulty: 'intermediate',
      source: 'custom',
      targetDurationSeconds: 30,
      retryOfAttemptId: ATTEMPT_ID,
      additionalContext: 'Keep the names private.',
    })
    expect(mocks.pickRecordPrompt).not.toHaveBeenCalled()
  })

  it('re-runs the owned lookup for a refreshed direct retry URL', async () => {
    const setup = useClient()

    await renderPage({ retry: ATTEMPT_ID })
    cleanup()
    await renderPage({ retry: ATTEMPT_ID })

    expect(setup.retryRead).toHaveBeenCalledTimes(2)
    expect(mocks.recordFlow).toHaveBeenCalledTimes(2)
    expect(mocks.pickRecordPrompt).not.toHaveBeenCalled()
  })
})
