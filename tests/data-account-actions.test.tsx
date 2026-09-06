// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteAccount: vi.fn(async () => ({ status: 'error' as const, message: 'Test error.' })),
  resetProgress: vi.fn(async () => ({ status: 'success' as const, message: 'Reset.' })),
}))

vi.mock('@/actions/account', () => mocks)

import { DataAndAccountActions } from '@/components/settings/data-account-actions'

beforeEach(() => vi.clearAllMocks())

describe('Settings data and account actions', () => {
  it('explains the two operations as distinct actions', () => {
    render(<DataAndAccountActions />)

    expect(
      screen.getByText('Delete all practice data and start over while keeping your account.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Permanently delete your FlowSense account and all associated data.'),
    ).toBeInTheDocument()
  })

  it('requires exact RESET confirmation in an accessible keyboard dialog', async () => {
    render(<DataAndAccountActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset progress' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Reset all progress?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(/responses, recordings, scores/)
    const input = screen.getByLabelText('Type RESET to continue')
    await waitFor(() => expect(input).toHaveFocus())
    const actions = screen.getAllByRole('button', { name: 'Reset progress' })
    const submit = actions.find((button) => button.getAttribute('type') === 'submit')
    expect(submit).toBeDisabled()

    fireEvent.change(input, { target: { value: 'reset' } })
    expect(submit).toBeDisabled()
    fireEvent.change(input, { target: { value: 'RESET' } })
    expect(submit).toBeEnabled()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('requires exact DELETE confirmation for the account action', async () => {
    render(<DataAndAccountActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete your FlowSense account?',
    })
    expect(dialog).toHaveAccessibleDescription(/cannot be undone/i)
    const input = screen.getByLabelText('Type DELETE to continue')
    const actions = screen.getAllByRole('button', { name: 'Delete account' })
    const submit = actions.find((button) => button.getAttribute('type') === 'submit')
    expect(submit).toBeDisabled()
    fireEvent.change(input, { target: { value: 'DELETE' } })
    expect(submit).toBeEnabled()
  })
})
