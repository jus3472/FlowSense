import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw { path }
  }),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { completeOnboarding } from '@/actions/onboarding'
import { updateProfile } from '@/actions/profile'
import { initialProfileFormState } from '@/lib/forms'

const USER_ID = '10000000-0000-4000-8000-000000000001'
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

interface FakeClientOptions {
  timezone?: string | null
  rpcError?: unknown
  metadataError?: unknown
  keepReadback?: boolean
  profileWriteData?: Record<string, unknown> | null
  profileWriteError?: unknown
}

function fakeClient(options: FakeClientOptions = {}) {
  let preferenceRows: Array<{ path_id: string; rank: number }> = [{ path_id: PATHS[0].id, rank: 0 }]
  let profilePayload: Record<string, unknown> | null = null
  const events: string[] = []

  const profileQuery = {
    select: vi.fn(() => profileQuery),
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn(async () => {
      if (profilePayload) {
        return {
          data:
            options.profileWriteData === undefined
              ? { ...profilePayload }
              : options.profileWriteData,
          error: options.profileWriteError ?? null,
        }
      }
      return { data: { id: USER_ID, timezone: options.timezone ?? null }, error: null }
    }),
    upsert: vi.fn((payload: Record<string, unknown>) => {
      events.push('profile')
      profilePayload = payload
      return profileQuery
    }),
  }

  const pathsQuery = {
    select: vi.fn(() => pathsQuery),
    eq: vi.fn(() => pathsQuery),
    order: vi.fn(async () => ({ data: PATHS, error: null })),
  }
  const preferencesQuery = {
    select: vi.fn(() => preferencesQuery),
    eq: vi.fn(() => preferencesQuery),
    order: vi.fn(async () => ({ data: preferenceRows, error: null })),
  }
  const rpc = vi.fn(async (_name: string, args: { path_ids: string[] }) => {
    events.push('preferences')
    if (!options.rpcError && !options.keepReadback) {
      preferenceRows = args.path_ids.map((pathId, rank) => ({ path_id: pathId, rank }))
    }
    return { data: null, error: options.rpcError ?? null }
  })
  const updateUser = vi.fn(async () => {
    events.push('metadata')
    return { data: { user: { id: USER_ID } }, error: options.metadataError ?? null }
  })

  return {
    client: {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
        updateUser,
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') return profileQuery
        if (table === 'practice_paths') return pathsQuery
        if (table === 'profile_path_preferences') return preferencesQuery
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    },
    events,
    profileQuery,
    rpc,
    updateUser,
  }
}

function preferenceForm(primary = 'general-speaking', secondaries: string[] = []) {
  const formData = new FormData()
  formData.set('primary_path', primary)
  for (const secondary of secondaries) formData.append('secondary_path', secondary)
  formData.set('timezone', 'America/New_York')
  return formData
}

function profileForm(displayName = '', timezone = 'America/New_York') {
  const formData = new FormData()
  formData.set('display_name', displayName)
  formData.set('timezone', timezone)
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('onboarding completion', () => {
  it('stores timezone and completion without changing legacy path preferences', async () => {
    const setup = fakeClient()
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(completeOnboarding(preferenceForm())).rejects.toMatchObject({ path: '/home' })

    expect(setup.events).toEqual(['profile', 'metadata'])
    expect(setup.profileQuery.upsert).toHaveBeenCalledWith(
      { id: USER_ID, timezone: 'America/New_York' },
      { onConflict: 'id' },
    )
    expect(setup.rpc).not.toHaveBeenCalled()
    expect(setup.client.from).not.toHaveBeenCalledWith('practice_paths')
    expect(setup.client.from).not.toHaveBeenCalledWith('profile_path_preferences')
  })

  it('uses UTC for an invalid browser timezone', async () => {
    const setup = fakeClient()
    mocks.createClient.mockResolvedValue(setup.client)
    const formData = preferenceForm()
    formData.set('timezone', 'Mars/Olympus')

    await expect(completeOnboarding(formData)).rejects.toMatchObject({ path: '/home' })
    expect(setup.profileQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'UTC' }),
      { onConflict: 'id' },
    )
  })

  it('does not overwrite a valid stored timezone', async () => {
    const setup = fakeClient({ timezone: 'Europe/London' })
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(completeOnboarding(preferenceForm())).rejects.toMatchObject({ path: '/home' })
    expect(setup.profileQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Europe/London' }),
      { onConflict: 'id' },
    )
  })

  it('does not complete onboarding after a mismatched profile readback', async () => {
    const setup = fakeClient({ profileWriteData: { id: USER_ID, timezone: 'UTC' } })
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(completeOnboarding(preferenceForm())).rejects.toMatchObject({
      path: '/onboarding/focus?error=save',
    })
    expect(setup.updateUser).not.toHaveBeenCalled()
  })
})

describe('settings profile persistence', () => {
  it('updates the profile without reading or writing path preferences, progress, or scores', async () => {
    const setup = fakeClient({ timezone: 'America/Los_Angeles' })
    mocks.createClient.mockResolvedValue(setup.client)
    const formData = profileForm(' River ', 'America/New_York')

    await expect(updateProfile(initialProfileFormState, formData)).resolves.toEqual({
      status: 'saved',
      message: 'Saved.',
      displayNameError: null,
    })
    expect(setup.profileQuery.upsert).toHaveBeenCalledWith(
      { id: USER_ID, display_name: 'River', timezone: 'America/Los_Angeles' },
      { onConflict: 'id' },
    )
    expect(setup.rpc).not.toHaveBeenCalled()
    expect(setup.client.from).not.toHaveBeenCalledWith('practice_paths')
    expect(setup.client.from).not.toHaveBeenCalledWith('profile_path_preferences')
    expect(setup.client.from).not.toHaveBeenCalledWith('lesson_progress')
    expect(setup.client.from).not.toHaveBeenCalledWith('attempts')
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('saves without the removed path fields', async () => {
    const setup = fakeClient()
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(updateProfile(initialProfileFormState, profileForm('River'))).resolves.toEqual({
      status: 'saved',
      message: 'Saved.',
      displayNameError: null,
    })
    expect(setup.profileQuery.upsert).toHaveBeenCalledWith(
      { id: USER_ID, display_name: 'River', timezone: 'America/New_York' },
      { onConflict: 'id' },
    )
  })

  it('does not report saved when profile readback differs', async () => {
    const setup = fakeClient({ profileWriteData: { display_name: 'Other', timezone: 'UTC' } })
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(
      updateProfile(initialProfileFormState, profileForm('River')),
    ).resolves.toMatchObject({ status: 'error' })
  })
})
