// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryList } from '@/components/history/history-list'
import type { HistoryEntry } from '@/lib/results/history'

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

vi.mock('@/lib/results/api', () => ({
  deleteAttempt: vi.fn(),
}))

const entries: HistoryEntry[] = [
  {
    id: 'attempt-1',
    createdAt: new Date(2026, 7, 25, 9, 5).toISOString(),
    promptText: 'Describe a place you know well.',
    score: 82,
  },
]

describe('HistoryList', () => {
  it('shows the response time in each history row', () => {
    render(<HistoryList entries={entries} focusPhrase="with less filler" />)

    expect(screen.getByText(/9:05\sAM/)).toBeInTheDocument()
  })

  it('dismisses delete confirmation on Escape and restores focus to delete', async () => {
    render(<HistoryList entries={entries} focusPhrase="with less filler" />)

    const deleteButton = screen.getByRole('button', { name: 'Delete response' })
    deleteButton.focus()
    fireEvent.click(deleteButton)

    await screen.findByText('Delete this response?')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText('Delete this response?')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete response' })).toHaveFocus()
    })
  })

  it('keeps long prompts and 3-digit scores stable in the mobile row layout', () => {
    const longPrompt =
      'When a community plan changes at the last minute, describe how you decide what to keep, what to adjust, and what you would say first.'

    render(
      <HistoryList
        entries={[
          {
            id: 'attempt-100',
            createdAt: '2026-08-25T12:00:00.000Z',
            promptText: longPrompt,
            score: 100,
          },
        ]}
        focusPhrase="with less filler"
      />,
    )

    expect(screen.getByRole('group', { name: 'Filter responses' })).toHaveClass('flex-wrap')
    expect(screen.getByRole('button', { name: 'High scores' })).toHaveClass('whitespace-nowrap')
    expect(screen.getByText(longPrompt)).toHaveClass('min-w-0', 'break-words')
    expect(screen.getByText(longPrompt).parentElement).toHaveClass('min-w-0', 'flex-1')
    expect(screen.getByText('100')).toHaveClass('w-12', 'shrink-0', 'text-right')
  })
})
