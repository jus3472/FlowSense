// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PrimaryNavigation } from '@/components/layout/primary-navigation'

const navigation = vi.hoisted(() => ({ pathname: '/home' }))

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

describe('PrimaryNavigation', () => {
  it('exposes Home, Progress, and History in that order with stable routes', () => {
    navigation.pathname = '/home'
    render(<PrimaryNavigation />)

    expect(
      screen.getAllByRole('link').map((link) => ({
        label: link.textContent,
        href: link.getAttribute('href'),
      })),
    ).toEqual([
      { label: 'Home', href: '/home' },
      { label: 'Progress', href: '/progress' },
      { label: 'History', href: '/history' },
    ])
    expect(screen.queryByRole('link', { name: 'Tracks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Practice' })).not.toBeInTheDocument()
  })

  it.each([
    ['/home', 'Home'],
    ['/practice', 'Home'],
    ['/practice/paths/interviews', 'Home'],
    ['/practice/custom', 'Home'],
    ['/history', 'History'],
    ['/progress', 'Progress'],
  ])('marks %s as %s with an accessible active state', (pathname, label) => {
    navigation.pathname = pathname
    render(<PrimaryNavigation />)

    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  })

  it('uses a compact full-width mobile row and desktop inline layout', () => {
    navigation.pathname = '/home'
    render(<PrimaryNavigation />)

    const navigationElement = screen.getByRole('navigation', { name: 'Main' })
    expect(navigationElement).toHaveClass('row-start-2', 'justify-between')
    expect(navigationElement).toHaveClass('sm:row-start-1', 'sm:justify-end')
  })
})
