// @vitest-environment jsdom

import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PreviousAttempts } from '@/components/results/previous-attempts'

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

describe('PreviousAttempts', () => {
  it('renders compact immutable result links with scores, timestamps, and useful names', () => {
    render(
      <PreviousAttempts
        attempts={[
          {
            attemptId: 'newer-attempt',
            score: 84,
            finishedAt: '2026-09-04T20:42:00.000Z',
          },
          {
            attemptId: 'older-unavailable',
            score: null,
            finishedAt: '2026-09-03T18:15:00.000Z',
          },
        ]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Previous attempts' })).toBeInTheDocument()
    expect(screen.getByText('84 / 100')).toBeInTheDocument()
    expect(screen.getByText('Overall unavailable')).toBeInTheDocument()
    expect(screen.getAllByRole('time')).toHaveLength(2)

    const scored = screen.getByRole('link', {
      name: /View attempt scored 84 out of 100 from September 4, 2026 at/i,
    })
    expect(scored).toHaveAttribute('href', '/attempts/newer-attempt')
    expect(scored).toHaveClass('min-h-11', 'focus-visible:bg-surface-sunken')

    const unavailable = screen.getByRole('link', {
      name: /View unavailable attempt from September 3, 2026 at/i,
    })
    expect(unavailable).toHaveAttribute('href', '/attempts/older-unavailable')
    expect(screen.queryByText(/lesson/i)).not.toBeInTheDocument()
  })

  it('hides the section when there are no other attempts', () => {
    const { container } = render(<PreviousAttempts attempts={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('accepts responsive placement from the result layout without changing link behavior', () => {
    render(
      <PreviousAttempts
        className="lg:col-start-2 lg:row-start-1"
        attempts={[
          {
            attemptId: 'attempt-1',
            score: 91,
            finishedAt: '2026-09-04T20:42:00.000Z',
          },
        ]}
      />,
    )

    expect(screen.getByRole('region', { name: 'Previous attempts' })).toHaveClass(
      'lg:col-start-2',
      'lg:row-start-1',
    )
    expect(screen.getByRole('link', { name: /View attempt scored 91 out of 100/ })).toHaveAttribute(
      'href',
      '/attempts/attempt-1',
    )
  })
})
