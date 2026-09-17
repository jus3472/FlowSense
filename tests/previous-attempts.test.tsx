// @vitest-environment jsdom

import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  it('shows only the latest attempt until the full history dialog is opened', async () => {
    render(
      <PreviousAttempts
        timezone="America/Los_Angeles"
        attempts={[
          {
            attemptId: 'older-unavailable',
            score: null,
            finishedAt: '2026-09-03T18:15:00.000Z',
          },
          {
            attemptId: 'newer-attempt',
            score: 84,
            finishedAt: '2026-09-04T20:42:00.000Z',
          },
        ]}
      />,
    )

    const summary = screen.getByRole('region', { name: 'Previous attempts' })
    const heading = within(summary).getByRole('heading', { name: 'Previous attempts' })
    expect(heading.closest('.rounded-card')).not.toBeNull()
    expect(within(summary).getByText('84 / 100')).toBeInTheDocument()
    expect(within(summary).queryByText('Overall unavailable')).not.toBeInTheDocument()
    expect(within(summary).getAllByRole('time')).toHaveLength(1)

    const scored = within(summary).getByRole('link', {
      name: 'View attempt scored 84 out of 100 from September 4, 2026 at 1:42 PM',
    })
    expect(scored).toHaveAttribute('href', '/attempts/newer-attempt')
    expect(scored).toHaveClass('min-h-11', 'focus-visible:bg-surface-sunken', 'px-4', 'py-2')
    expect(within(summary).getByText('Sep 4, 2026 · 1:42 PM')).toBeInTheDocument()

    const trigger = within(summary).getByRole('button', { name: 'View all attempts' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'All previous attempts' })
    expect(
      within(dialog).queryByText('Your most recent attempt appears first.'),
    ).not.toBeInTheDocument()
    expect(within(dialog).getAllByRole('link')).toHaveLength(2)
    expect(within(dialog).getAllByRole('time')).toHaveLength(2)
    expect(within(dialog).getByText('Overall unavailable')).toBeInTheDocument()

    const unavailable = within(dialog).getByRole('link', {
      name: 'View unavailable attempt from September 3, 2026 at 11:15 AM',
    })
    expect(unavailable).toHaveAttribute('href', '/attempts/older-unavailable')
    expect(unavailable).toHaveClass('px-6', 'py-4')
    expect(within(dialog).getByText('Sep 3, 2026 · 11:15 AM')).toBeInTheDocument()
    expect(screen.queryByText(/lesson/i)).not.toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('hides the section when there are no other attempts', () => {
    const { container } = render(<PreviousAttempts attempts={[]} timezone="America/New_York" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('accepts responsive placement from the result layout without changing link behavior', () => {
    render(
      <PreviousAttempts
        className="lg:col-start-2 lg:row-start-1"
        timezone="America/Los_Angeles"
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
    expect(screen.getByRole('heading', { name: 'Previous attempts' })).toHaveClass(
      'text-lg',
      'font-semibold',
    )
    expect(screen.getByRole('link', { name: /View attempt scored 91 out of 100/ })).toHaveAttribute(
      'href',
      '/attempts/attempt-1',
    )
    expect(screen.queryByRole('button', { name: 'View all attempts' })).not.toBeInTheDocument()
  })
})
