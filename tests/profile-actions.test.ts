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

import { saveFocusAreas } from '@/actions/onboarding'
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
  let preferenceRows: Array<{ path_id: string; rank: number }> = [
    { path_id: PATHS[0].id, rank: 0 },
  ]
  let profilePayload: Record<string, unknown> | null = null
  const events: string[] = []

  const profileQuery = {
    select: vi.fn(() => profileQuery),
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn(async () => {
      if (profilePayload) {
        return {
          data:
            options.profileWriteData === undefined ? { ...profilePayload } : options.profileWriteData,
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('onboarding path persistence', () => {
  it('verifies profile, timezone, atomic path order, and readback before completion', async () => {
    const setup = fakeClient()
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(
      saveFocusAreas(preferenceForm('interviews', ['presentations'])),
    ).rejects.toMatchObject({ path: '/home' })

    expect(setup.events).toEqual(['profile', 'preferences', 'metadata'])
    expect(setup.profileQuery.upsert).toHaveBeenCalledWith(
      {
        id: USER_ID,
        focus_areas: ['interviews', 'presentations'],
        timezone: 'America/New_York',
      },
      { onConflict: 'id' },
    )
    expect(setup.rpc).toHaveBeenCalledWith('replace_profile_path_preferences', {
      path_ids: [PATHS[1].id, PATHS[2].id],
    })
  })

  it('requires a primary path before any authenticated write', async () => {
    await expect(saveFocusAreas(new FormData())).rejects.toMatchObject({
      path: '/onboarding/focus?error=primary',
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('uses UTC for an invalid browser timezone', async () => {
    const setup = fakeClient()
    mocks.createClient.mockResolvedValue(setup.client)
    const formData = preferenceForm()
    formData.set('timezone', 'Mars/Olympus')

    await expect(saveFocusAreas(formData)).rejects.toMatchObject({ path: '/home' })
    expect(setup.profileQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'UTC' }),
      { onConflict: 'id' },
    )
  })

  it('does not overwrite a valid stored timezone', async () => {
    const setup = fakeClient({ timezone: 'Europe/London' })
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(saveFocusAreas(preferenceForm())).rejects.toMatchObject({ path: '/home' })
    expect(setup.profileQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Europe/London' }),
      { onConflict: 'id' },
    )
  })

  it.each([{ rpcError: { code: 'PGRST500' } }, { keepReadback: true }])(
    'does not complete onboarding after an atomic save failure or mismatched readback',
    async (options) => {
      const setup = fakeClient(options)
      mocks.createClient.mockResolvedValue(setup.client)

      await expect(saveFocusAreas(preferenceForm('interviews'))).rejects.toMatchObject({
        path: '/onboarding/focus?error=save',
      })
      expect(setup.updateUser).not.toHaveBeenCalled()
    },
  )
})

describe('settings path persistence', () => {
  it('changes the primary path through the atomic RPC without mutating progress or scores', async () => {
    const setup = fakeClient({ timezone: 'America/Los_Angeles' })
    mocks.createClient.mockResolvedValue(setup.client)
    const formData = preferenceForm('conversations', ['general-speaking'])
    formData.set('display_name', ' River ')

    await expect(updateProfile(initialProfileFormState, formData)).resolves.toEqual({
      status: 'saved',
      message: 'Saved.',
      displayNameError: null,
    })
    expect(setup.profileQuery.upsert).toHaveBeenCalledWith(
      { id: USER_ID, display_name: 'River', timezone: 'America/Los_Angeles' },
      { onConflict: 'id' },
    )
    expect(setup.rpc).toHaveBeenCalledWith('replace_profile_path_preferences', {
      path_ids: [PATHS[3].id, PATHS[0].id],
    })
    expect(setup.client.from).not.toHaveBeenCalledWith('lesson_progress')
    expect(setup.client.from).not.toHaveBeenCalledWith('attempts')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/home')
  })

  it('returns a visible error when the primary path is missing', async () => {
    await expect(updateProfile(initialProfileFormState, new FormData())).resolves.toEqual({
      status: 'error',
      message: 'Choose one primary path.',
      displayNameError: null,
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('does not report saved when preference readback differs', async () => {
    const setup = fakeClient({ keepReadback: true })
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(
      updateProfile(initialProfileFormState, preferenceForm('interviews')),
    ).resolves.toMatchObject({ status: 'error' })
  })
})
