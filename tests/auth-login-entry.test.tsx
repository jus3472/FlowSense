// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), signInWithOAuth: vi.fn() }))

vi.mock('@/actions/authenticate', () => ({ authenticate: mocks.authenticate }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithOAuth: mocks.signInWithOAuth } }),
}))

import LoginPage, { generateMetadata } from '@/app/login/page'
import type { AuthFormState } from '@/lib/forms'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('login entry intent', () => {
  it('opens the login form when the login mode is requested', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ mode: 'login' }) }))

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in', pressed: true })).toBeInTheDocument()
    const form = document.querySelector('form')
    expect(form).not.toBeNull()
    expect(within(form!).getByRole('button', { name: 'Log in' })).toHaveAttribute('type', 'submit')
    expect(screen.queryByText('Pick up where you left off.')).not.toBeInTheDocument()
    await expect(
      generateMetadata({ searchParams: Promise.resolve({ mode: 'login' }) }),
    ).resolves.toMatchObject({ title: 'Log in to FlowSense' })
  })

  it('keeps the signup form as the default account-creation entry', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign up', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toHaveAttribute('type', 'submit')
    expect(screen.queryByText('Two short steps, then your first prompt.')).not.toBeInTheDocument()
    await expect(generateMetadata({ searchParams: Promise.resolve({}) })).resolves.toMatchObject({
      title: 'Create your FlowSense account',
    })
    await expect(
      generateMetadata({ searchParams: Promise.resolve({ mode: ['login', 'signup'] }) }),
    ).resolves.toMatchObject({ title: 'Create your FlowSense account' })
  })

  it('starts Google OAuth with the same-origin callback and shows bounded callback failures', async () => {
    mocks.signInWithOAuth.mockResolvedValue({ error: null })
    render(await LoginPage({ searchParams: Promise.resolve({ mode: 'login', oauth: 'failed' }) }))

    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in did not finish. Try again.')
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    await waitFor(() =>
      expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: { redirectTo: 'http://localhost:3000/auth/callback' },
      }),
    )
  })

  it('keeps the submitted email visible after a wrong-password response', async () => {
    mocks.authenticate.mockImplementation(async (_previous: AuthFormState, formData: FormData) => ({
      formError: 'Your email or password is not correct.',
      notice: null,
      fieldErrors: {},
      email: String(formData.get('email') ?? '').trim(),
    }))
    render(await LoginPage({ searchParams: Promise.resolve({ mode: 'login' }) }))

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: ' speaker@example.test ' },
    })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } })
    const submit = screen
      .getAllByRole('button', { name: 'Log in' })
      .find((button) => button.getAttribute('type') === 'submit')
    expect(submit).toBeDefined()
    fireEvent.click(submit!)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Your email or password is not correct.'),
    )
    expect(screen.getByLabelText('Email')).toHaveValue('speaker@example.test')
    expect(screen.getByLabelText('Password')).toHaveFocus()
  })
})
