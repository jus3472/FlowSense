// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TighterVersion } from '@/components/results/tighter-version'

const props = {
  original: 'I think we should keep the meeting short because everyone is busy.',
  tightened: 'Keep the meeting short because everyone is busy.',
}

function openTighterVersion() {
  fireEvent.click(screen.getByRole('button', { name: /a tighter version/i }))
}

describe('TighterVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('announces that the tighter version is copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<TighterVersion {...props} />)
    openTighterVersion()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })
    expect(screen.getByText('Tighter version copied.')).toHaveAttribute('aria-live', 'polite')
    expect(writeText).toHaveBeenCalledWith(props.tightened)
  })

  it('shows a fallback when copying is blocked and clears it on the next attempt', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('blocked'))
    Object.assign(navigator, { clipboard: { writeText } })

    render(<TighterVersion {...props} />)
    openTighterVersion()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await screen.findByText('Copying is blocked. You can select the text instead.')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })

    await waitFor(() => {
      expect(
        screen.queryByText('Copying is blocked. You can select the text instead.'),
      ).not.toBeInTheDocument()
    })
  })

  it('clears the reset timer when it unmounts', async () => {
    vi.useFakeTimers()
    const clearTimeout = vi.spyOn(window, 'clearTimeout')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const view = render(<TighterVersion {...props} />)
    openTighterVersion()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })
    view.unmount()

    expect(clearTimeout).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
