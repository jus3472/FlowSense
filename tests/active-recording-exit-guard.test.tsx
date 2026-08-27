// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVE_RECORDING_EXIT_MESSAGE,
  useActiveRecordingExitGuard,
} from '@/components/record/use-active-recording-exit-guard'

function Guard({
  active,
  exposeAllow,
  onHistoryTraversal,
}: {
  active: boolean
  exposeAllow?: (allow: (href: string) => void) => void
  onHistoryTraversal?: () => void
}) {
  const { allowNextNavigation } = useActiveRecordingExitGuard(active, onHistoryTraversal)
  exposeAllow?.(allowNextNavigation)
  return null
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

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

  it('blocks a Next client-side link when the user stays', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const reachedLink = vi.fn()
    render(
      <>
        <Guard active />
        <a href="/history" onClick={reachedLink}>
          History
        </a>
      </>,
    )

    const link = document.querySelector('a')
    expect(link).not.toBeNull()
    fireEvent.click(link as HTMLAnchorElement)

    expect(confirm).toHaveBeenCalledWith(ACTIVE_RECORDING_EXIT_MESSAGE)
    expect(reachedLink).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
  })

  it('allows normal link interaction while idle', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const reachedLink = vi.fn((event: React.MouseEvent) => event.preventDefault())
    render(
      <>
        <Guard active={false} />
        <a href="/history" onClick={reachedLink}>
          History
        </a>
      </>,
    )

    fireEvent.click(document.querySelector('a') as HTMLAnchorElement)

    expect(reachedLink).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('blocks programmatic App Router history transitions', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Guard active />)

    window.history.pushState({}, '', '/practice')

    expect(confirm).toHaveBeenCalledWith(ACTIVE_RECORDING_EXIT_MESSAGE)
    expect(window.location.pathname).toBe('/')
  })

  it('releases capture synchronously when back or forward traversal cannot be cancelled', () => {
    const release = vi.fn()
    render(<Guard active onHistoryTraversal={release} />)
    let releasedBeforeLaterListeners = false
    const laterRouterListener = () => {
      releasedBeforeLaterListeners = release.mock.calls.length === 1
    }
    window.addEventListener('popstate', laterRouterListener)

    window.dispatchEvent(new PopStateEvent('popstate'))
    window.dispatchEvent(new PopStateEvent('popstate'))

    window.removeEventListener('popstate', laterRouterListener)
    expect(release).toHaveBeenCalledTimes(1)
    expect(releasedBeforeLaterListeners).toBe(true)
  })

  it('allows the flow result transition without prompting', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    let allow: ((href: string) => void) | undefined
    render(<Guard active exposeAllow={(callback) => (allow = callback)} />)

    allow?.('/attempts/00000000-0000-4000-8000-000000000001')
    window.history.replaceState({}, '', '/attempts/00000000-0000-4000-8000-000000000001')

    expect(confirm).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/attempts/00000000-0000-4000-8000-000000000001')
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
    expect(removeEventListener).toHaveBeenCalledTimes(4)
    expect(removeEventListener).toHaveBeenCalledWith('popstate', expect.any(Function))
  })
})
