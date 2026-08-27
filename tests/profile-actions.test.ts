import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw { path }
  }),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { saveFocusAreas, skipFocusAreas } from '@/actions/onboarding'
import { updateProfile } from '@/actions/profile'

const userId = '10000000-0000-4000-8000-000000000001'

interface ProfileWriteResult {
  data: Record<string, unknown> | null
  error: { message: string } | null
}

function fakeClient(options: {
  profileResult: ProfileWriteResult
  metadataError?: { message: string } | null
}) {
  const events: string[] = []
  const upsert = vi.fn((_payload: Record<string, unknown>) => {
    events.push('profile')
    return {
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => options.profileResult),
      })),
    }
  })
  const updateUser = vi.fn(async () => {
    events.push('metadata')
    return { data: { user: { id: userId } }, error: options.metadataError ?? null }
  })
  return {
    client: {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
        updateUser,
      },
      from: vi.fn(() => ({ upsert })),
    },
    events,
    updateUser,
    upsert,
  }
}

beforeEach(() => {
  mocks.createClient.mockReset()
  mocks.redirect.mockClear()
  mocks.revalidatePath.mockReset()
})

describe('onboarding profile persistence', () => {
  it('upserts and verifies mapped preferences before marking onboarding complete', async () => {
    const setup = fakeClient({
      profileResult: {
        data: {
          id: userId,
          focus_areas: ['meetings-conversations', 'speaking-on-the-spot'],
        },
        error: null,
      },
    })
    mocks.createClient.mockResolvedValue(setup.client)
    const formData = new FormData()
    formData.append('focus', 'meetings')
    formData.append('focus', 'confidence')

    await expect(saveFocusAreas(formData)).rejects.toMatchObject({ path: '/home' })
    expect(setup.events).toEqual(['profile', 'metadata'])
    expect(setup.upsert).toHaveBeenCalledWith(
      {
        id: userId,
        focus_areas: ['meetings-conversations', 'speaking-on-the-spot'],
      },
      { onConflict: 'id' },
    )
  })

  it.each([
    { data: null, error: null },
    { data: null, error: { message: 'write failed' } },
    { data: { id: 'different-user', focus_areas: [] }, error: null },
  ])(
    'does not mark onboarding complete after an unverified profile write',
    async (profileResult) => {
      const setup = fakeClient({ profileResult })
      mocks.createClient.mockResolvedValue(setup.client)

      await expect(saveFocusAreas(new FormData())).rejects.toMatchObject({
        path: '/onboarding/focus?error=save',
      })
      expect(setup.updateUser).not.toHaveBeenCalled()
    },
  )

  it('keeps onboarding recoverable when metadata fails after a durable profile write', async () => {
    const setup = fakeClient({
      profileResult: { data: { id: userId, focus_areas: [] }, error: null },
      metadataError: { message: 'metadata failed' },
    })
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(saveFocusAreas(new FormData())).rejects.toMatchObject({
      path: '/onboarding/focus?error=save',
    })
    expect(setup.events).toEqual(['profile', 'metadata'])
  })

  it('creates a missing profile before completing a skipped preference step', async () => {
    const setup = fakeClient({
      profileResult: { data: { id: userId }, error: null },
    })
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(skipFocusAreas()).rejects.toMatchObject({ path: '/home' })
    expect(setup.upsert).toHaveBeenCalledWith({ id: userId }, { onConflict: 'id' })
    expect(setup.events).toEqual(['profile', 'metadata'])
  })
})

describe('settings profile persistence', () => {
  it('upserts a missing profile and verifies the saved values', async () => {
    const setup = fakeClient({
      profileResult: {
        data: { id: userId, display_name: 'River', focus_areas: ['presentations'] },
        error: null,
      },
    })
    mocks.createClient.mockResolvedValue(setup.client)
    const formData = new FormData()
    formData.set('display_name', ' River ')
    formData.append('focus', 'presentations')

    await expect(
      updateProfile({ status: 'idle', message: null, displayNameError: null }, formData),
    ).resolves.toEqual({ status: 'saved', message: 'Saved.', displayNameError: null })
    expect(setup.upsert).toHaveBeenCalledWith(
      { id: userId, display_name: 'River', focus_areas: ['presentations'] },
      { onConflict: 'id' },
    )
  })

  it('returns a safe error when an upsert affects no profile row', async () => {
    const setup = fakeClient({ profileResult: { data: null, error: null } })
    mocks.createClient.mockResolvedValue(setup.client)

    await expect(
      updateProfile({ status: 'idle', message: null, displayNameError: null }, new FormData()),
    ).resolves.toEqual({
      status: 'error',
      message: 'Your changes did not save. Check your connection and try again.',
      displayNameError: null,
    })
  })

  it('round-trips an ordered valid name and practice-goal selection', async () => {
    const setup = fakeClient({
      profileResult: {
        data: {
          id: userId,
          display_name: 'River',
          focus_areas: ['difficult-conversations', 'general-speaking'],
        },
        error: null,
      },
    })
    mocks.createClient.mockResolvedValue(setup.client)
    const formData = new FormData()
    formData.set('display_name', 'River')
    formData.append('focus', 'difficult-conversations')
    formData.append('focus', 'general-speaking')

    await expect(
      updateProfile({ status: 'idle', message: null, displayNameError: null }, formData),
    ).resolves.toEqual({ status: 'saved', message: 'Saved.', displayNameError: null })
    expect(setup.upsert).toHaveBeenCalledWith(
      {
        id: userId,
        display_name: 'River',
        focus_areas: ['difficult-conversations', 'general-speaking'],
      },
      { onConflict: 'id' },
    )
  })
})
