// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('@/actions/auth', () => ({ logOut: vi.fn() }))
vi.mock('@/actions/profile', () => ({ updateProfile: vi.fn() }))
vi.mock('@/actions/onboarding', () => ({
  saveFocusAreas: vi.fn(),
  skipFocusAreas: vi.fn(),
}))

import SettingsPage from '@/app/(app)/settings/page'
import FocusPage from '@/app/onboarding/focus/page'
import { loadProfilePreferences } from '@/lib/profile-preferences'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const PRIVATE_ERROR_TEXT = 'River and private stored preferences must not be logged.'

interface QueryResult {
  data: unknown
  error: unknown
}

function client(result: QueryResult, throws?: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(() => (throws ? Promise.reject(throws) : Promise.resolve(result))),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
    from: vi.fn(() => query),
  }
}

async function renderSettings(result: QueryResult, throws?: unknown) {
  mocks.createClient.mockResolvedValue(client(result, throws))
  render(await SettingsPage({ searchParams: Promise.resolve({}) }))
}

async function renderFocus(result: QueryResult, throws?: unknown) {
  mocks.createClient.mockResolvedValue(client(result, throws))
  render(await FocusPage({ searchParams: Promise.resolve({}) }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('preference page load failures', () => {
  it('keeps the Settings mutation form unavailable and refreshes the route after query failure', async () => {
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderSettings({
      data: null,
      error: { code: 'PGRST500', message: PRIVATE_ERROR_TEXT, details: ['interviews'] },
    })

    expect(screen.getByRole('heading', { name: 'Your settings did not load' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(logging).toHaveBeenCalledExactlyOnceWith('[profiles] preference load failed', {
      operation: 'settings',
      reason: 'query_error',
      code: 'PGRST500',
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain(PRIVATE_ERROR_TEXT)
    expect(JSON.stringify(logging.mock.calls)).not.toContain('interviews')
  })

  it('keeps onboarding choices unavailable and refreshes that route after a thrown read failure', async () => {
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const thrown = Object.assign(new Error(PRIVATE_ERROR_TEXT), { code: 'NETWORK_ERROR' })
    await renderFocus({ data: null, error: null }, thrown)

    expect(
      screen.getByRole('heading', { name: 'Your practice goals did not load' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(logging).toHaveBeenCalledExactlyOnceWith('[profiles] preference load failed', {
      operation: 'onboarding_practice_goals',
      reason: 'query_error',
      code: 'NETWORK_ERROR',
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain(PRIVATE_ERROR_TEXT)
  })
})

describe('safe preference fallbacks', () => {
  it('keeps a genuinely missing profile usable on Settings and onboarding', async () => {
    await renderSettings({ data: null, error: null })
    expect(screen.getByLabelText('Display name')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()

    await renderFocus({ data: null, error: null })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
  })

  it('loads null pre-v2 fields without treating them as a query failure', async () => {
    const result = await loadProfilePreferences(
      Promise.resolve({ data: { display_name: null, focus_areas: null }, error: null }),
    )

    expect(result).toEqual({
      status: 'ready',
      data: { displayName: '', focusAreas: [], profileExists: true },
    })
  })

  it('migrates stale legacy goals and preserves valid saved values in both forms', async () => {
    const saved = {
      display_name: 'River',
      focus_areas: ['meetings', 'confidence', 'presentations', 'unknown'],
    }
    await renderSettings({ data: saved, error: null })
    expect(screen.getByLabelText('Display name')).toHaveValue('River')
    expect(screen.getByRole('button', { name: 'Presentations' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Meetings and conversations' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Speaking on the spot' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    cleanup()
    await renderFocus({ data: { focus_areas: saved.focus_areas }, error: null })
    expect(screen.getByRole('button', { name: 'Presentations' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Meetings and conversations' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Speaking on the spot' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('fails closed on malformed profile fields instead of rendering empty defaults', async () => {
    const result = await loadProfilePreferences(
      Promise.resolve({ data: { display_name: 42, focus_areas: ['interviews'] }, error: null }),
    )
    expect(result).toMatchObject({ status: 'failure', reason: 'invalid_response' })
  })
})
