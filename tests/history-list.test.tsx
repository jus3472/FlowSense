// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryList } from '@/components/history/history-list'
import { deleteAttempt } from '@/lib/results/api'
import type { HistoryEntry } from '@/lib/results/history'

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))

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
    createdAt: '2026-08-25T13:05:00.000Z',
    promptText: 'Describe a place you know well.',
    score: 82,
    practiceMode: null,
    promptSource: null,
    retryOfAttemptId: null,
  },
]

const timeContext = {
  renderedAt: '2026-08-25T16:00:00.000Z',
  timezone: 'America/New_York',
} as const

describe('HistoryList', () => {
  beforeEach(() => {
    vi.mocked(deleteAttempt).mockReset()
    navigation.push.mockReset()
    navigation.refresh.mockReset()
  })

  it('shows the response time in each history row', () => {
    render(<HistoryList {...timeContext} entries={entries} focusPhrase="with less filler" />)

    expect(screen.getByText(/9:05\sAM/)).toBeInTheDocument()
    expect(screen.getByText('General')).toBeInTheDocument()
  })

  it('hydrates the serialized initial date when local midnight passes', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const container = document.createElement('div')
    document.body.append(container)
    let root: Root | undefined
    const initial = (
      <HistoryList
        entries={[{ ...entries[0]!, createdAt: '2026-09-05T03:30:00.000Z' }]}
        focusPhrase="with less filler"
        renderedAt="2026-09-05T03:49:00.000Z"
        timezone="America/New_York"
      />
    )

    try {
      vi.setSystemTime('2026-09-05T03:49:00.000Z')
      container.innerHTML = renderToString(initial)
      vi.setSystemTime('2026-09-05T04:01:00.000Z')

      await act(async () => {
        root = hydrateRoot(container, initial)
      })

      expect(container).toHaveTextContent('Today')
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
      consoleError.mockRestore()
      vi.useRealTimers()
    }
  })

  it('moves focus to confirm delete when confirmation opens', async () => {
    render(<HistoryList {...timeContext} entries={entries} focusPhrase="with less filler" />)

    const deleteButton = screen.getByRole('button', { name: 'Delete response' })
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm delete' })).toHaveFocus()
    })
  })

  it('exposes a named modal alert dialog and hides the covered row controls', async () => {
    render(<HistoryList {...timeContext} entries={entries} focusPhrase="with less filler" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this response?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(
      'This response, its recording, and its score will be permanently deleted. Your Progress, streak, stars, and lesson unlocks may change.',
    )
    const coveredLink = screen.getByText('Describe a place you know well.').closest('a')
    expect(coveredLink).toHaveAttribute('aria-hidden', 'true')
    expect(coveredLink).toHaveAttribute('tabindex', '-1')
    expect(screen.queryByRole('link', { name: /Describe a place/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete response' })).not.toBeInTheDocument()
  })

  it('cycles Tab and Shift+Tab within Confirm and Cancel', async () => {
    render(<HistoryList {...timeContext} entries={entries} focusPhrase="with less filler" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this response?' })
    const confirm = screen.getByRole('button', { name: 'Confirm delete' })
    const cancel = screen.getByRole('button', { name: 'Cancel delete' })

    await waitFor(() => expect(confirm).toHaveFocus())
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(confirm).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
  })

  it('dismisses delete confirmation on cancel and restores focus to delete', async () => {
    render(<HistoryList {...timeContext} entries={entries} focusPhrase="with less filler" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel delete' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete response' })).toHaveFocus()
    })
    expect(navigation.refresh).not.toHaveBeenCalled()
  })

  it('dismisses delete confirmation on Escape and restores focus to delete', async () => {
    render(<HistoryList {...timeContext} entries={entries} focusPhrase="with less filler" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    await screen.findByText('Delete this response?')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText('Delete this response?')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete response' })).toHaveFocus()
    })
    expect(navigation.refresh).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and restores a retryable confirm action when deletion fails', async () => {
    vi.mocked(deleteAttempt)
      .mockRejectedValueOnce(new Error('It could not be deleted.'))
      .mockResolvedValueOnce({ redirectTo: '/history' })
    render(<HistoryList {...timeContext} entries={entries} focusPhrase="with less filler" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this response?' })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('It could not be deleted.')
    const confirm = within(dialog).getByRole('button', { name: 'Confirm delete' })
    expect(confirm).not.toBeDisabled()
    expect(confirm.querySelector('[data-loading-spinner="true"]')).not.toBeInTheDocument()
    await waitFor(() => expect(confirm).toHaveFocus())
    expect(navigation.refresh).not.toHaveBeenCalled()

    fireEvent.click(confirm)
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledOnce())
  })

  it('shows stable loading feedback, blocks duplicate deletion, then focuses a remaining row', async () => {
    let finishDelete: (() => void) | undefined
    vi.mocked(deleteAttempt).mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = () => resolve({ redirectTo: '/history' })
      }),
    )
    render(
      <HistoryList
        {...timeContext}
        entries={[
          entries[0]!,
          {
            ...entries[0]!,
            id: 'attempt-2',
            promptText: 'Explain one useful routine.',
          },
        ]}
        focusPhrase="with less filler"
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete response' })[0]!)
    const confirm = await screen.findByRole('button', { name: 'Confirm delete' })
    fireEvent.click(confirm)

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this response?' })
    const cancel = screen.getByRole('button', { name: 'Cancel delete' })
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(cancel).toHaveAttribute('aria-disabled', 'true')
    expect(cancel).not.toBeDisabled()
    expect(confirm).toHaveAccessibleName('Confirm delete')
    expect(confirm).toHaveTextContent('Delete response')
    expect(confirm.querySelector('[data-loading-spinner="true"]')).toBeInTheDocument()
    expect(within(confirm).getByRole('status')).toHaveClass('sr-only')
    fireEvent.click(confirm)
    expect(deleteAttempt).toHaveBeenCalledOnce()
    expect(confirm).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(cancel).toHaveFocus()

    await act(async () => finishDelete?.())

    await waitFor(() => {
      expect(screen.queryByText('Describe a place you know well.')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Response deleted.')
      expect(screen.getByRole('button', { name: 'Delete response' })).toHaveFocus()
    })
    expect(navigation.refresh).toHaveBeenCalledOnce()
  })

  it('focuses the History container after deleting the final visible row', async () => {
    vi.mocked(deleteAttempt).mockResolvedValueOnce({ redirectTo: '/history' })
    render(<HistoryList {...timeContext} entries={entries} focusPhrase="with less filler" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Response deleted.')
      expect(screen.getByRole('region', { name: 'History responses' })).toHaveFocus()
    })
    expect(navigation.refresh).toHaveBeenCalledOnce()
  })

  it('keeps long prompts and 3-digit scores stable in the mobile row layout', () => {
    const longPrompt =
      'When a community plan changes at the last minute, describe how you decide what to keep, what to adjust, and what you would say first.'

    render(
      <HistoryList
        {...timeContext}
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

    const filter = screen.getByRole('combobox', { name: 'Show responses' })
    expect(within(filter).getAllByRole('option')).toHaveLength(8)
    expect(filter).toHaveClass('min-h-11', 'appearance-none')
    expect(screen.queryByRole('link', { name: 'High scores' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Low scores' })).not.toBeInTheDocument()
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
    render(<HistoryList {...timeContext} entries={modeEntries} focusPhrase="with less filler" />)

    expect(screen.getByText('General Practice · Library prompt')).toBeInTheDocument()
    expect(screen.getByText('Interview')).toBeInTheDocument()
    expect(screen.getByText('Presentation')).toBeInTheDocument()
    expect(screen.getByText('Conversation · Custom prompt · Retry')).toBeInTheDocument()
    expect(screen.getByText('Conversation prompt')).toBeInTheDocument()
  })

  it('shows structured lesson, stars, pass, checkpoint, and retry context', () => {
    render(
      <HistoryList
        {...timeContext}
        entries={[
          {
            ...entries[0]!,
            score: 74,
            retryOfAttemptId: 'prior-attempt',
            lesson: {
              pathSlug: 'interviews',
              pathTitle: 'Interviews',
              chapterLevel: 'beginner',
              chapterTitle: 'Beginner Interviews',
              lessonTitle: 'Handling conflict',
              lessonPosition: 10,
              checkpoint: true,
              stars: 1,
              outcome: 'passed',
            },
          },
        ]}
        focusPhrase="with less filler"
      />,
    )

    expect(screen.getAllByText('Interviews')).toHaveLength(2)
    expect(screen.getByText('Describe a place you know well.')).toBeInTheDocument()
    expect(screen.getByText('Beginner · Lesson 10')).toBeInTheDocument()
    expect(screen.queryByText('Handling conflict')).not.toBeInTheDocument()
    expect(screen.getByText('Checkpoint · Retry')).toBeInTheDocument()
    expect(screen.getByLabelText('1 stars')).toHaveTextContent('★☆☆')
    expect(screen.getByText('Passed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Describe a place.*Lesson 10/ })).toHaveAttribute(
      'href',
      '/attempts/attempt-1',
    )
  })

  it('shows a structured below-threshold response as not passed', () => {
    render(
      <HistoryList
        {...timeContext}
        entries={[
          {
            ...entries[0]!,
            score: 64,
            lesson: {
              pathSlug: 'presentations',
              pathTitle: 'Presentations',
              chapterLevel: 'beginner',
              chapterTitle: 'Beginner Presentations',
              lessonTitle: 'Open with one point',
              lessonPosition: 2,
              checkpoint: false,
              stars: 0,
              outcome: 'not_passed',
            },
          },
        ]}
        focusPhrase="with less filler"
      />,
    )

    expect(screen.getByText('Not passed')).toBeInTheDocument()
    expect(screen.queryByLabelText(/stars/)).not.toBeInTheDocument()
  })

  it('uses the shared compact category filter and explains an empty filter', () => {
    render(
      <HistoryList
        {...timeContext}
        entries={[]}
        focusPhrase="with less filler"
        hasAnyEntries
        query={{ metadata: 'interview', page: 1 }}
      />,
    )

    const filters = screen.getByRole('navigation', { name: 'Response filter' })
    const select = within(filters).getByRole('combobox', { name: 'Show responses' })
    expect(select).toHaveValue('interview')
    expect(
      within(filters)
        .getAllByRole('option')
        .map((option) => ({
          label: option.textContent,
          value: (option as HTMLOptionElement).value,
        })),
    ).toEqual([
      { label: 'All', value: 'all' },
      { label: 'General Speaking', value: 'general' },
      { label: 'Interviews', value: 'interview' },
      { label: 'Presentations', value: 'presentation' },
      { label: 'Conversations', value: 'conversation' },
      { label: 'Custom Prompts', value: 'custom' },
      { label: 'Other', value: 'other' },
      { label: 'Retries', value: 'retry' },
    ])
    expect(screen.queryByRole('group', { name: 'Filter responses' })).not.toBeInTheDocument()
    expect(screen.getByText('Nothing in this filter')).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'custom' } })
    expect(navigation.push).toHaveBeenCalledWith('/history?show=custom')
  })

  it('links complete and partial rows through the canonical attempt route', () => {
    render(
      <HistoryList
        {...timeContext}
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
    expect(screen.getByText('Overall unavailable')).toBeInTheDocument()
  })

  it('keeps the active filters while paging through bounded history', () => {
    render(
      <HistoryList
        {...timeContext}
        entries={entries}
        focusPhrase="with less filler"
        query={{ metadata: 'custom', page: 2 }}
        hasPrevious
        hasNext
      />,
    )

    expect(screen.getByRole('link', { name: 'Newer responses' })).toHaveAttribute(
      'href',
      '/history?show=custom',
    )
    expect(screen.getByRole('link', { name: 'Older responses' })).toHaveAttribute(
      'href',
      '/history?show=custom&page=3',
    )
  })

  it('uses a graceful prompt fallback without rendering score-trend UI', () => {
    render(
      <HistoryList
        {...timeContext}
        entries={[
          { ...entries[0]!, id: 'missing', promptText: null },
          { ...entries[0]!, id: 'blank', promptText: '   ' },
        ]}
        focusPhrase="with less filler"
      />,
    )

    expect(screen.getAllByText('Prompt unavailable')).toHaveLength(2)
    expect(screen.queryByText('Compatible score trend')).not.toBeInTheDocument()
    expect(screen.queryByText(/cohort average/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps unsupported and partial responses visible with factual labels', () => {
    render(
      <HistoryList
        {...timeContext}
        entries={[
          { ...entries[0]!, id: 'unsupported', resultKind: 'unsupported', score: null },
          { ...entries[0]!, id: 'partial', resultKind: 'partial', score: null },
        ]}
        focusPhrase="with less filler"
      />,
    )

    expect(screen.getByText(/Unsupported result/)).toBeInTheDocument()
    expect(screen.getByText(/Partial result/)).toBeInTheDocument()
    expect(screen.getByText('Unsupported')).toBeInTheDocument()
    expect(screen.getByText('Overall unavailable')).toBeInTheDocument()
  })
})
