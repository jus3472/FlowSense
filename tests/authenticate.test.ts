import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialAuthFormState } from '@/lib/forms'

const mocks = vi.hoisted(() => ({
  clearHandoff: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw { path }
  }),
}))

vi.mock('@/lib/practice/custom-handoff-cookie', () => ({
  clearCustomPracticeHandoffCookie: mocks.clearHandoff,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import { authenticate } from '@/actions/authenticate'

function loginForm(email: string, password = 'wrong-password') {
  const form = new FormData()
  form.set('mode', 'login')
  form.set('email', email)
  form.set('password', password)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('password authentication state', () => {
  it.each(['Invalid login credentials', 'Email not confirmed', 'Unexpected auth failure'])(
    'uses the same response and retains the normalized email for login failure: %s',
    async (message) => {
      mocks.createClient.mockResolvedValue({
        auth: {
          signInWithPassword: vi.fn(async () => ({ error: { message } })),
        },
      })

      await expect(
        authenticate(initialAuthFormState, loginForm('  speaker@example.test  ')),
      ).resolves.toEqual({
        formError: 'Your email or password is not correct.',
        notice: null,
        fieldErrors: {},
        email: 'speaker@example.test',
      })
    },
  )

  it('does not disclose an existing account through a signup error', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn(async () => ({
          data: { session: null },
          error: { message: 'User already registered' },
        })),
      },
    })
    const form = loginForm('speaker@example.test')
    form.set('mode', 'signup')

    await expect(authenticate(initialAuthFormState, form)).resolves.toEqual({
      formError: 'Your account could not be created. Try again.',
      notice: null,
      fieldErrors: {},
      email: 'speaker@example.test',
    })
  })

  it('retains a valid email when another field fails local validation', async () => {
    await expect(
      authenticate(initialAuthFormState, loginForm('speaker@example.test', '')),
    ).resolves.toEqual({
      formError: null,
      notice: null,
      fieldErrors: { password: 'Enter your password.' },
      email: 'speaker@example.test',
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
})
