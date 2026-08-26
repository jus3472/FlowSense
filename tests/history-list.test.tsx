// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryList } from '@/components/history/history-list'
import { deleteAttempt } from '@/lib/results/api'
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
    practiceMode: null,
    promptSource: null,
    retryOfAttemptId: null,
  },
]

describe('HistoryList', () => {
  beforeEach(() => {
    vi.mocked(deleteAttempt).mockReset()
  })

  it('shows the response time in each history row', () => {
    render(<HistoryList entries={entries} focusPhrase="with less filler" />)

    expect(screen.getByText(/9:05\sAM/)).toBeInTheDocument()
    expect(screen.getByText('General')).toBeInTheDocument()
  })

  it('moves focus to confirm delete when confirmation opens', async () => {
    render(<HistoryList entries={entries} focusPhrase="with less filler" />)

    const deleteButton = screen.getByRole('button', { name: 'Delete response' })
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm delete' })).toHaveFocus()
    })
  })

  it('dismisses delete confirmation on cancel and restores focus to delete', async () => {
    render(<HistoryList entries={entries} focusPhrase="with less filler" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel delete' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete response' })).toHaveFocus()
    })
  })

  it('dismisses delete confirmation on Escape and restores focus to delete', async () => {
    render(<HistoryList entries={entries} focusPhrase="with less filler" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    await screen.findByText('Delete this response?')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText('Delete this response?')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete response' })).toHaveFocus()
    })
  })

  it('restores focus to delete when deletion fails', async () => {
    vi.mocked(deleteAttempt).mockRejectedValueOnce(new Error('It could not be deleted.'))
    render(<HistoryList entries={entries} focusPhrase="with less filler" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }))

    await screen.findByRole('alert')

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

  it('shows every mode and compact custom or retry context', () => {
    const modeEntries: HistoryEntry[] = [
      { ...entries[0]!, id: 'general', practiceMode: 'practice', promptSource: 'library' },
      {
        ...entries[0]!,
        id: 'interview',
        practiceMode: 'interview',
        promptText: 'Interview prompt',
      },
      {
        ...entries[0]!,
        id: 'presentation',
        practiceMode: 'presentation',
        promptText: 'Presentation prompt',
      },
      {
        ...entries[0]!,
        id: 'conversation',
        practiceMode: 'conversation',
        promptText: 'Conversation prompt',
        promptSource: 'custom',
        retryOfAttemptId: 'prior',
      },
    ]
    render(<HistoryList entries={modeEntries} focusPhrase="with less filler" />)

    expect(screen.getByText('General Practice · Library prompt')).toBeInTheDocument()
    expect(screen.getByText('Interview')).toBeInTheDocument()
    expect(screen.getByText('Presentation')).toBeInTheDocument()
    expect(screen.getByText('Conversation · Custom prompt · Retry')).toBeInTheDocument()
  })

  it('combines the metadata selector with score filters and explains an empty filter', () => {
    const filtered: HistoryEntry[] = [
      { ...entries[0]!, id: 'interview-high', practiceMode: 'interview', score: 90 },
      {
        ...entries[0]!,
        id: 'interview-low',
        practiceMode: 'interview',
        score: 40,
        promptText: 'Low interview',
      },
      {
        ...entries[0]!,
        id: 'conversation',
        practiceMode: 'conversation',
        score: 70,
        promptText: 'Conversation',
      },
    ]
    render(<HistoryList entries={filtered} focusPhrase="with less filler" />)

    fireEvent.change(screen.getByLabelText('Show responses'), { target: { value: 'interview' } })
    fireEvent.click(screen.getByRole('button', { name: 'High scores' }))
    expect(screen.getByText('Describe a place you know well.')).toBeInTheDocument()
    expect(screen.queryByText('Low interview')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Show responses'), { target: { value: 'custom' } })
    expect(screen.getByText('Nothing in this filter')).toBeInTheDocument()
  })
})
