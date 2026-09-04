// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppHeader } from '@/components/layout/app-header'

vi.mock('next/navigation', () => ({ usePathname: () => '/progress' }))
vi.mock('next/link', () => ({
  default: function MockLink({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))
vi.mock('@/actions/auth', () => ({ logOut: vi.fn() }))

describe('AppHeader', () => {
  it('places Progress in primary navigation and not in the account menu', () => {
    render(<AppHeader activity={null} />)

    const main = screen.getByRole('navigation', { name: 'Main' })
    expect(within(main).getByRole('link', { name: 'Progress' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(within(menu).queryByRole('menuitem', { name: 'Progress' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()
  })

  it('renders the compact accessible streak beside the main navigation', () => {
    render(
      <AppHeader
        activity={{
          current: 3,
          todayActive: true,
          timezone: 'UTC',
          today: '2026-09-04',
          dailyGoal: 'complete',
        }}
      />,
    )

    expect(
      screen.getByRole('img', { name: "3 day streak. Today's practice complete." }),
    ).toHaveTextContent('3')
  })
})
