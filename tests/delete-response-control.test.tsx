// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteResponseControl } from '@/components/results/delete-response-control'
import { attemptResultHref } from '@/lib/curriculum/routes'
import { deleteAttempt } from '@/lib/results/api'

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}))

vi.mock('@/lib/results/api', () => ({
  deleteAttempt: vi.fn(),
}))

describe('DeleteResponseControl', () => {
  beforeEach(() => {
    vi.mocked(deleteAttempt).mockReset()
    navigation.replace.mockReset()
    navigation.refresh.mockReset()
  })

  it('opens an accessible confirmation with the full impact copy and focuses Cancel', async () => {
    render(<DeleteResponseControl attemptId="attempt-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this response?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(
      'This response, its recording, and its score will be permanently deleted. Your Progress, streak, stars, and lesson unlocks may change.',
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
  })

  it('can join the full-width result action stack', () => {
    render(<DeleteResponseControl attemptId="attempt-1" fullWidth />)

    const trigger = screen.getByRole('button', { name: 'Delete response' })
    expect(trigger).toHaveClass('w-full', 'min-h-14', 'border', 'text-negative')
    expect(trigger.parentElement).toHaveClass('w-full')
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<DeleteResponseControl attemptId="attempt-1" />)
    const trigger = screen.getByRole('button', { name: 'Delete response' })
    fireEvent.click(trigger)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('traps keyboard focus between the confirmation actions', async () => {
    render(<DeleteResponseControl attemptId="attempt-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    const dialog = screen.getByRole('alertdialog')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const remove = within(dialog).getByRole('button', { name: 'Delete response' })

    await waitFor(() => expect(cancel).toHaveFocus())
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(remove).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(cancel).toHaveFocus()
  })

  it('keeps a stable label with a spinner, blocks duplicates, and replaces the removed route', async () => {
    let finishDelete: ((value: Awaited<ReturnType<typeof deleteAttempt>>) => void) | undefined
    vi.mocked(deleteAttempt).mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = resolve
      }),
    )
    render(<DeleteResponseControl attemptId="attempt-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    const remove = within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete response',
    })
    fireEvent.click(remove)
    fireEvent.click(remove)

    expect(deleteAttempt).toHaveBeenCalledOnce()
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('aria-busy', 'true')
    expect(remove).toHaveAccessibleName('Delete response')
    expect(remove).toHaveTextContent('Delete response')
    expect(remove.querySelector('[data-loading-spinner="true"]')).toBeInTheDocument()
    expect(within(remove).getByRole('status')).toHaveClass('sr-only')

    await act(async () => finishDelete?.({ redirectTo: attemptResultHref('attempt-2') }))

    await waitFor(() => {
      expect(deleteAttempt).toHaveBeenCalledWith('attempt-1')
      expect(navigation.replace).toHaveBeenCalledWith('/attempts/attempt-2')
      expect(navigation.refresh).toHaveBeenCalledOnce()
    })
  })

  it('keeps the dialog open and reports a recoverable deletion failure', async () => {
    vi.mocked(deleteAttempt).mockRejectedValueOnce(new Error('The response could not be deleted.'))
    render(<DeleteResponseControl attemptId="attempt-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete response' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete response' }),
    )

    const dialog = screen.getByRole('alertdialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The response could not be deleted.',
    )
    const remove = within(dialog).getByRole('button', { name: 'Delete response' })
    expect(remove).not.toBeDisabled()
    expect(remove.querySelector('[data-loading-spinner="true"]')).not.toBeInTheDocument()
    await waitFor(() => expect(remove).toHaveFocus())
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})
