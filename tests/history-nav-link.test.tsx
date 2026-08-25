// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryNavLink } from '@/components/layout/history-nav-link'

const navigation = vi.hoisted(() => ({ pathname: '/history' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}))

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

describe('HistoryNavLink', () => {
  it('marks the History link as current on the history page', () => {
    navigation.pathname = '/history'

    render(<HistoryNavLink />)

    const link = screen.getByRole('link', { name: 'History' })
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link).toHaveClass('bg-accent-soft', 'text-accent')
  })

  it('uses the inactive style away from the history page', () => {
    navigation.pathname = '/home'

    render(<HistoryNavLink />)

    const link = screen.getByRole('link', { name: 'History' })
    expect(link).not.toHaveAttribute('aria-current')
    expect(link).toHaveClass('text-foreground', 'hover:bg-surface-sunken')
    expect(link).not.toHaveClass('bg-accent-soft', 'text-accent')
  })
})
