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
    createdAt: '2026-08-25T12:00:00.000Z',
    promptText: 'Describe a place you know well.',
    score: 82,
  },
]

describe('HistoryList', () => {
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
})
