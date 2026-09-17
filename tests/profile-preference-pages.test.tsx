// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('@/actions/auth', () => ({ logOut: vi.fn() }))
vi.mock('@/actions/account', () => ({ deleteAccount: vi.fn(), resetProgress: vi.fn() }))
vi.mock('@/actions/profile', () => ({ updateProfile: vi.fn() }))
vi.mock('@/actions/onboarding', () => ({ completeOnboarding: vi.fn() }))

import SettingsPage from '@/app/(app)/settings/page'
import FocusPage from '@/app/onboarding/focus/page'
import { loadProfilePreferences } from '@/lib/profile-preferences'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const PRIVATE_ERROR_TEXT = 'River and private stored preferences must not be logged.'
const PATHS = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    slug: 'general-speaking',
    title: 'General Speaking',
    mode: 'practice',
    position: 1,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    slug: 'interviews',
    title: 'Interviews',
    mode: 'interview',
    position: 2,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    slug: 'presentations',
    title: 'Presentations',
    mode: 'presentation',
    position: 3,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    slug: 'conversations',
    title: 'Conversations',
    mode: 'conversation',
    position: 4,
    active: true,
  },
] as const

interface QueryResult {
  data: unknown
  error: unknown
}

interface ClientOptions {
  profile: QueryResult
  profileThrows?: unknown
  paths?: QueryResult
  preferences?: QueryResult
}

function chainResult(result: QueryResult) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(async () => result),
  }
  return query
}

function client(options: ClientOptions) {
  const profileQuery = {
    select: vi.fn(() => profileQuery),
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn(() =>
      options.profileThrows
        ? Promise.reject(options.profileThrows)
        : Promise.resolve(options.profile),
    ),
  }
  const pathQuery = chainResult(options.paths ?? { data: PATHS, error: null })
  const preferenceQuery = chainResult(
    options.preferences ?? {
      data: [{ path_id: PATHS[0].id, rank: 0 }],
      error: null,
    },
  )
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID, email: 'signed-in@example.com' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') return profileQuery
      if (table === 'practice_paths') return pathQuery
      if (table === 'profile_path_preferences') return preferenceQuery
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

async function renderSettings(options: ClientOptions) {
  const setup = client(options)
  mocks.createClient.mockResolvedValue(setup)
  render(await SettingsPage({ searchParams: Promise.resolve({}) }))
  return setup
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('preference page load failures', () => {
  it('keeps the Settings mutation form unavailable after a profile query failure', async () => {
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderSettings({
      profile: {
        data: null,
        error: { code: 'PGRST500', message: PRIVATE_ERROR_TEXT, details: ['interviews'] },
      },
    })

    expect(screen.getByRole('heading', { name: 'Your settings did not load' })).toBeInTheDocument()
    expect(screen.getByText('signed-in@example.com')).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(logging).toHaveBeenCalledWith('[profiles] preference load failed', {
      operation: 'settings',
      reason: 'query_error',
      code: 'PGRST500',
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain(PRIVATE_ERROR_TEXT)
  })

  it('does not load path preferences for Settings', async () => {
    const setup = await renderSettings({
      profile: { data: { display_name: 'River', focus_areas: [], timezone: null }, error: null },
      preferences: { data: [{ path_id: PATHS[1].id, rank: 2 }], error: null },
    })

    expect(screen.getByLabelText('Display name')).toHaveValue('River')
    expect(setup.from).toHaveBeenCalledTimes(1)
    expect(setup.from).toHaveBeenCalledWith('profiles')
  })
})

describe('onboarding track introduction', () => {
  it('shows all four tracks without asking for a primary track', async () => {
    const setup = client({ profile: { data: null, error: null } })
    mocks.createClient.mockResolvedValue(setup)
    render(await FocusPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Practice across four tracks' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Available tracks' })
    for (const name of ['General Speaking', 'Interviews', 'Presentations', 'Conversations']) {
      expect(list).toHaveTextContent(name)
    }
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Primary track')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Home' })).toBeInTheDocument()
    expect(setup.from).not.toHaveBeenCalled()
  })

  it('renders only the remaining profile fields in Settings', async () => {
    await renderSettings({
      profile: {
        data: { display_name: 'River', focus_areas: ['presentations'], timezone: null },
        error: null,
      },
      preferences: {
        data: [
          { path_id: PATHS[1].id, rank: 0 },
          { path_id: PATHS[2].id, rank: 1 },
        ],
        error: null,
      },
    })

    expect(screen.getByLabelText('Display name')).toHaveValue('River')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Starting track')).not.toBeInTheDocument()
    expect(screen.queryByText('Additional paths')).not.toBeInTheDocument()
    expect(screen.queryByText('Primary', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Profile & account' })).toContainElement(
      screen.getByText('signed-in@example.com'),
    )
    expect(screen.getByRole('region', { name: 'Profile & account' })).toContainElement(
      screen.getByRole('button', { name: 'Log out' }),
    )
    expect(screen.getByRole('region', { name: 'Data & privacy' })).toContainElement(
      screen.getByRole('button', { name: 'Reset progress' }),
    )
    expect(screen.getByRole('region', { name: 'Data & privacy' })).toContainElement(
      screen.getByRole('button', { name: 'Delete account' }),
    )
    expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument()
  })

  it('loads null pre-v2 profile fields with UTC fallback', async () => {
    const result = await loadProfilePreferences(
      Promise.resolve({
        data: { display_name: null, focus_areas: null, timezone: null },
        error: null,
      }),
    )

    expect(result).toEqual({
      status: 'ready',
      data: { displayName: '', focusAreas: [], timezone: 'UTC', profileExists: true },
    })
  })

  it('rejects malformed profile fields instead of rendering empty defaults', async () => {
    const result = await loadProfilePreferences(
      Promise.resolve({ data: { display_name: 42, focus_areas: [] }, error: null }),
    )
    expect(result).toMatchObject({ status: 'failure', reason: 'invalid_response' })
  })
})
