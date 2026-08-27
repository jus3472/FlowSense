// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryList } from '@/components/history/history-list'
import { deleteAttempt } from '@/lib/results/api'
import type { HistoryEntry } from '@/lib/results/history'

const navigation = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
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
    navigation.push.mockReset()
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
    expect(screen.getByRole('link', { name: 'High scores' })).toHaveClass('whitespace-nowrap')
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
    render(
      <HistoryList
        entries={[]}
        focusPhrase="with less filler"
        hasAnyEntries
        query={{ metadata: 'interview', score: 'high', page: 1 }}
      />,
    )

    expect(screen.getByLabelText('Show responses')).toHaveValue('interview')
    expect(screen.getByRole('link', { name: 'High scores' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Low scores' })).toHaveAttribute(
      'href',
      '/history?show=interview&score=low',
    )
    expect(screen.getByText('Nothing in this filter')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Show responses'), { target: { value: 'custom' } })
    expect(navigation.push).toHaveBeenCalledWith('/history?show=custom&score=high')
  })

  it('links complete and partial rows through the canonical attempt route', () => {
    render(
      <HistoryList
        entries={[
          entries[0]!,
          {
            ...entries[0]!,
            id: 'partial-attempt',
            promptText: 'Partial response',
            score: null,
          },
        ]}
        focusPhrase="with less filler"
      />,
    )

    expect(screen.getByRole('link', { name: /Describe a place/ })).toHaveAttribute(
      'href',
      '/attempts/attempt-1',
    )
    expect(screen.getByRole('link', { name: /Partial response/ })).toHaveAttribute(
      'href',
      '/attempts/partial-attempt',
    )
    expect(screen.getByText('Incomplete')).toBeInTheDocument()
  })

  it('keeps the active filters while paging through bounded history', () => {
    render(
      <HistoryList
        entries={entries}
        focusPhrase="with less filler"
        query={{ metadata: 'custom', score: 'low', page: 2 }}
        hasPrevious
        hasNext
      />,
    )

    expect(screen.getByRole('link', { name: 'Newer responses' })).toHaveAttribute(
      'href',
      '/history?show=custom&score=low',
    )
    expect(screen.getByRole('link', { name: 'Older responses' })).toHaveAttribute(
      'href',
      '/history?show=custom&score=low&page=3',
    )
  })

  it('labels the trend and average as limited to the loaded page', () => {
    render(
      <HistoryList
        entries={[
          entries[0]!,
          { ...entries[0]!, id: 'attempt-2', score: 72 },
          { ...entries[0]!, id: 'attempt-3', score: 92 },
        ]}
        focusPhrase="with less filler"
        hasNext
      />,
    )

    expect(screen.getByText('Scores on this page')).toBeInTheDocument()
    expect(screen.getByText('page average 82')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Scores on this page, averaging 82 out of 100' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Scores over time')).not.toBeInTheDocument()
  })
})
