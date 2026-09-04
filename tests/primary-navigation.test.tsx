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
  it('exposes the four coherent destinations with stable routes', () => {
    navigation.pathname = '/home'
    render(<PrimaryNavigation />)

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home')
    expect(screen.getByRole('link', { name: 'Tracks' })).toHaveAttribute('href', '/practice')
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/history')
    expect(screen.getByRole('link', { name: 'Progress' })).toHaveAttribute('href', '/progress')
    expect(screen.queryByRole('link', { name: 'Practice' })).not.toBeInTheDocument()
  })

  it.each([
    ['/practice', 'Tracks'],
    ['/practice/paths/interviews', 'Tracks'],
    ['/history', 'History'],
    ['/progress', 'Progress'],
  ])('marks %s as %s with an accessible active state', (pathname, label) => {
    navigation.pathname = pathname
    render(<PrimaryNavigation />)

    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  })

  it.each([
    '/practice/practice',
    '/practice/interview',
    '/practice/presentation',
    '/practice/conversation',
    '/practice/custom',
  ])('does not add a replacement primary destination for %s', (pathname) => {
    navigation.pathname = pathname
    render(<PrimaryNavigation />)

    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument()
  })

  it('uses a compact full-width mobile row and desktop inline layout', () => {
    navigation.pathname = '/home'
    render(<PrimaryNavigation />)

    const navigationElement = screen.getByRole('navigation', { name: 'Main' })
    expect(navigationElement).toHaveClass('row-start-2', 'justify-between')
    expect(navigationElement).toHaveClass('sm:row-start-1', 'sm:justify-end')
  })
})
