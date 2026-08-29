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
vi.mock('@/actions/profile', () => ({ updateProfile: vi.fn() }))
vi.mock('@/actions/onboarding', () => ({ saveFocusAreas: vi.fn() }))

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
      options.profileThrows ? Promise.reject(options.profileThrows) : Promise.resolve(options.profile),
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
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
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
  mocks.createClient.mockResolvedValue(client(options))
  render(await SettingsPage({ searchParams: Promise.resolve({}) }))
}

async function renderFocus(options: ClientOptions) {
  mocks.createClient.mockResolvedValue(client(options))
  render(await FocusPage({ searchParams: Promise.resolve({}) }))
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

  it('keeps onboarding unavailable after a path preference query failure', async () => {
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderFocus({
      profile: { data: null, error: null },
      preferences: { data: null, error: { code: 'PGRST500', message: PRIVATE_ERROR_TEXT } },
    })

    expect(screen.getByRole('heading', { name: 'Your paths did not load' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    expect(logging).toHaveBeenCalledWith('[paths] preference operation failed', {
      operation: 'onboarding',
      reason: 'query_error',
      code: 'PGRST500',
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain(PRIVATE_ERROR_TEXT)
  })

  it('fails closed on malformed ordered path rows', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderSettings({
      profile: { data: { display_name: 'River', focus_areas: [], timezone: null }, error: null },
      preferences: { data: [{ path_id: PATHS[1].id, rank: 2 }], error: null },
    })

    expect(screen.getByRole('heading', { name: 'Your settings did not load' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Interviews' })).not.toBeInTheDocument()
  })
})

describe('path preference forms', () => {
  it('uses General Speaking as the safe required default with no skip action', async () => {
    await renderFocus({
      profile: { data: null, error: null },
      preferences: { data: [], error: null },
    })

    expect(
      screen.getByRole('heading', { name: 'What do you want to get better at?' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'General Speaking' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })

  it('renders a saved primary and ordered optional secondary paths in Settings', async () => {
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
    expect(screen.getByRole('radio', { name: 'Interviews' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Presentations' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Interviews' })).toBeDisabled()
  })

  it('lets the user change the primary and add another path without changing availability', async () => {
    await renderFocus({ profile: { data: null, error: null } })

    fireEvent.click(screen.getByRole('radio', { name: 'Interviews' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Presentations' }))

    expect(screen.getByRole('radio', { name: 'Interviews' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Presentations' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Conversations' })).toBeEnabled()
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
