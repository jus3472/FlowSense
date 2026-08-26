// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useActiveRecordingExitGuard } from '@/components/record/use-active-recording-exit-guard'

function Guard({ active }: { active: boolean }) {
  useActiveRecordingExitGuard(active)
  return null
}

describe('useActiveRecordingExitGuard', () => {
  it('prevents a browser exit while capture or processing is active', () => {
    render(<Guard active />)

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('does not guard ready, error, or completed states', () => {
    render(<Guard active={false} />)

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('removes the guard when processing finishes and when the flow unmounts', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { rerender, unmount } = render(<Guard active />)

    rerender(<Guard active={false} />)
    expect(removeEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    const afterProcessing = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterProcessing)
    expect(afterProcessing.defaultPrevented).toBe(false)

    rerender(<Guard active />)
    unmount()
    expect(removeEventListener).toHaveBeenCalledTimes(2)
  })
})
