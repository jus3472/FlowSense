// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/actions/auth', () => ({ logOut: vi.fn() }))

import { LogoutForm } from '@/components/settings/logout-form'

describe('logout recovery interface', () => {
  it('shows a real retry form when logout does not finish', () => {
    render(<LogoutForm failed />)

    expect(screen.getByRole('alert')).toHaveTextContent("You're still logged in. Try again.")
    const retry = screen.getByRole('button', { name: 'Try logging out again' })
    expect(retry).toHaveAttribute('type', 'submit')
    expect(retry.closest('form')).not.toBeNull()
  })

  it('keeps the ordinary logout state concise', () => {
    render(<LogoutForm />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out' })).toHaveAttribute('type', 'submit')
  })

  it('uses the same server action from Settings and the overflow menu', () => {
    const settings = readFileSync('src/components/settings/logout-form.tsx', 'utf8')
    const menu = readFileSync('src/components/layout/overflow-menu.tsx', 'utf8')
    const page = readFileSync('src/app/(app)/settings/page.tsx', 'utf8')

    expect(settings).toContain('<form action={logOut}>')
    expect(menu).toContain('<form action={logOut}>')
    expect(page).toContain("<LogoutForm failed={query.logout === 'failed'} />")
  })
})
