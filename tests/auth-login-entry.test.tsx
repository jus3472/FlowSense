// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/actions/authenticate', () => ({
  authenticate: vi.fn(),
}))

import LoginPage from '@/app/login/page'

describe('login entry intent', () => {
  it('opens the login form when the login mode is requested', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ mode: 'login' }) }))

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in', pressed: true })).toBeInTheDocument()
    const form = document.querySelector('form')
    expect(form).not.toBeNull()
    expect(within(form!).getByRole('button', { name: 'Log in' })).toHaveAttribute('type', 'submit')
  })

  it('keeps the signup form as the default account-creation entry', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign up', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toHaveAttribute('type', 'submit')
  })
})
