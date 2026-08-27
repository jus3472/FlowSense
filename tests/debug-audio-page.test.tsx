// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  audioDebugRouteEnabled: vi.fn(),
  createClient: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))
vi.mock('@/lib/env/server', () => ({
  audioDebugRouteEnabled: mocks.audioDebugRouteEnabled,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/components/debug/audio-probe', () => ({
  AudioProbe: ({
    items,
    emptyMessage,
  }: {
    items: Array<{ id: string; label: string; url: string }>
    emptyMessage?: string
  }) => (
    <div data-testid="audio-probe">
      {items.length === 0
        ? (emptyMessage ?? 'No attempts with audio to probe.')
        : items.map((item) => (
            <span key={item.id} data-url={item.url}>
              {item.label}
            </span>
          ))}
    </div>
  ),
}))

import AudioDebugPage from '@/app/(app)/debug/audio/page'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '20000000-0000-4000-8000-000000000002'
const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')
const REDIRECT = new Error('NEXT_REDIRECT;/login')
const PRIVATE_ERROR_TEXT = 'private database and storage details'

interface DebugAttempt {
  id: string
  user_id: string
  prompt_text: string
  duration_ms: number
  audio_path: string | null
  metrics: unknown
  created_at: string
}

interface SignResult {
  data: { signedUrl: string } | null
  error: unknown
}

interface ClientOptions {
  userId?: string | null
  attempts?: readonly DebugAttempt[]
  queryError?: unknown
  queryThrows?: unknown
  sign?: (path: string) => Promise<SignResult>
}

function attempt(index: number, userId = USER_ID): DebugAttempt {
  return {
    id: `attempt-${index}`,
    user_id: userId,
    prompt_text: `Prompt ${index}`,
    duration_ms: index * 1_000,
    audio_path: `${userId}/attempt-${index}.webm`,
    metrics: { capture: { mime_type: 'audio/webm;codecs=opus' } },
    created_at: `2026-08-27T12:00:${String(index).padStart(2, '0')}.000Z`,
  }
}

function client(options: ClientOptions = {}) {
  const filters: Array<{ column: string; value: unknown }> = []
  let selectedUserId: string | null = null
  const source = [...(options.attempts ?? [])]
  const createSignedUrl = vi.fn(
    options.sign ??
      (async (path: string) => ({
        data: { signedUrl: `https://signed.test/${path}` },
        error: null,
      })),
  )
  const query = {
    select: vi.fn(),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push({ column, value })
      if (column === 'user_id' && typeof value === 'string') selectedUserId = value
      return query
    }),
    not: vi.fn((column: string, operator: string, value: unknown) => {
      filters.push({ column, value: `${operator}:${String(value)}` })
      return query
    }),
    order: vi.fn(() => query),
    limit: vi.fn(async (count: number) => {
      if (options.queryThrows) throw options.queryThrows
      const data = source
        .filter((row) => selectedUserId === null || row.user_id === selectedUserId)
        .filter((row) => row.audio_path !== null)
        .slice(0, count)
      return { data, error: options.queryError ?? null }
    }),
  }
  query.select.mockReturnValue(query)

  const from = vi.fn(() => query)
  return {
    supabase: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: options.userId === null ? null : { id: options.userId ?? USER_ID } },
        })),
      },
      from,
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    },
    createSignedUrl,
    filters,
    from,
    limit: query.limit,
  }
}

async function renderPage() {
  render(await AudioDebugPage())
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.audioDebugRouteEnabled.mockReturnValue(true)
  mocks.notFound.mockImplementation(() => {
    throw NOT_FOUND
  })
  mocks.redirect.mockImplementation(() => {
    throw REDIRECT
  })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('audio debug route hardening', () => {
  it('is unavailable in production before creating a Supabase client', async () => {
    mocks.audioDebugRouteEnabled.mockReturnValue(false)

    await expect(AudioDebugPage()).rejects.toBe(NOT_FOUND)

    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('retains authentication in allowed environments', async () => {
    const setup = client({ userId: null })
    mocks.createClient.mockResolvedValue(setup.supabase)

    await expect(AudioDebugPage()).rejects.toBe(REDIRECT)

    expect(mocks.redirect).toHaveBeenCalledWith('/login')
    expect(setup.from).not.toHaveBeenCalled()
  })

  it('treats an owned empty result as a normal empty state', async () => {
    const setup = client()
    mocks.createClient.mockResolvedValue(setup.supabase)

    await renderPage()

    expect(screen.getByTestId('audio-probe')).toHaveTextContent('No attempts with audio to probe.')
    expect(screen.queryByText('Audio diagnostics unavailable')).not.toBeInTheDocument()
    expect(setup.filters).toContainEqual({ column: 'user_id', value: USER_ID })
    expect(setup.limit).toHaveBeenCalledWith(5)
    expect(setup.createSignedUrl).not.toHaveBeenCalled()
  })

  it('selects and signs only attempts explicitly scoped to the current user', async () => {
    const owned = attempt(1)
    const other = attempt(2, OTHER_USER_ID)
    const setup = client({ attempts: [owned, other] })
    mocks.createClient.mockResolvedValue(setup.supabase)

    await renderPage()

    expect(screen.getByText(/Prompt 1/)).toBeInTheDocument()
    expect(screen.queryByText(/Prompt 2/)).not.toBeInTheDocument()
    expect(setup.createSignedUrl).toHaveBeenCalledExactlyOnceWith(owned.audio_path, 3_600)
  })

  it.each([
    ['returned', { queryError: { code: 'PGRST500', message: PRIVATE_ERROR_TEXT } }],
    ['thrown', { queryThrows: Object.assign(new Error(PRIVATE_ERROR_TEXT), { code: 'NETWORK' }) }],
  ])('renders a safe recoverable state for a %s attempt-query failure', async (_label, options) => {
    const setup = client(options)
    mocks.createClient.mockResolvedValue(setup.supabase)

    await renderPage()

    expect(screen.getByText('Audio diagnostics unavailable')).toBeInTheDocument()
    expect(screen.getByText('Your recordings could not be loaded. Try again.')).toBeInTheDocument()
    expect(screen.queryByText(PRIVATE_ERROR_TEXT)).not.toBeInTheDocument()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(PRIVATE_ERROR_TEXT)
  })

  it('signs only the bounded page in parallel and keeps successful items after one failure', async () => {
    let active = 0
    let maximumActive = 0
    const setup = client({
      attempts: Array.from({ length: 7 }, (_, index) => attempt(index + 1)),
      sign: async (path) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 0))
        active -= 1
        if (path.includes('attempt-3')) {
          return {
            data: null,
            error: { code: 'SIGN_FAILED', message: PRIVATE_ERROR_TEXT },
          }
        }
        return { data: { signedUrl: `https://signed.test/${path}` }, error: null }
      },
    })
    mocks.createClient.mockResolvedValue(setup.supabase)

    await renderPage()

    expect(setup.createSignedUrl).toHaveBeenCalledTimes(5)
    expect(maximumActive).toBe(5)
    expect(screen.getByRole('status')).toHaveTextContent('Some recordings could not be attached.')
    expect(screen.getByText(/Prompt 1/)).toBeInTheDocument()
    expect(screen.queryByText(/Prompt 3/)).not.toBeInTheDocument()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(PRIVATE_ERROR_TEXT)
  })

  it('keeps environment reads centralized and removes the stale debug variable', () => {
    const page = readFileSync('src/app/(app)/debug/audio/page.tsx', 'utf8')
    const example = readFileSync('.env.example', 'utf8')

    expect(page).toContain('audioDebugRouteEnabled()')
    expect(page).not.toContain('process.env')
    expect(page).toContain('Promise.all(')
    expect(example).not.toContain('DEEPGRAM_DEBUG')
  })
})
