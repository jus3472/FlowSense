'use client'

import { useCallback, useEffect, useRef } from 'react'

export const ACTIVE_RECORDING_EXIT_MESSAGE = 'Your recording is still in progress. Leave this page?'

function navigationUrl(value: string | URL | null | undefined): URL | null {
  if (value === null || value === undefined) return null
  try {
    return new URL(value.toString(), window.location.href)
  } catch {
    return null
  }
}

function changesPage(destination: URL): boolean {
  if (destination.origin !== window.location.origin) return false
  const current = new URL(window.location.href)
  return destination.pathname !== current.pathname || destination.search !== current.search
}

function linkFor(event: MouseEvent): HTMLAnchorElement | null {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null
  }
  const target = event.target
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return null
  return anchor
}

/**
 * Protects both document exits and App Router transitions while a recording or
 * in-memory processing step is active. Next 16 has no global router event API,
 * so link clicks and the native history methods used by the App Router are
 * guarded together. A popstate traversal is not cancellable after dispatch;
 * its callback synchronously tears down capture before the route can commit.
 */
export function useActiveRecordingExitGuard(active: boolean, onHistoryTraversal?: () => void) {
  const allowedNavigationRef = useRef<string | null>(null)
  const onHistoryTraversalRef = useRef(onHistoryTraversal)

  useEffect(() => {
    onHistoryTraversalRef.current = onHistoryTraversal
  }, [onHistoryTraversal])

  const allowNextNavigation = useCallback((href: string) => {
    const destination = navigationUrl(href)
    allowedNavigationRef.current = destination?.href ?? null
  }, [])

  useEffect(() => {
    if (!active) {
      allowedNavigationRef.current = null
      return
    }

    const confirmNavigation = (destination: URL): boolean => {
      if (allowedNavigationRef.current === destination.href) {
        allowedNavigationRef.current = null
        return true
      }
      return window.confirm(ACTIVE_RECORDING_EXIT_MESSAGE)
    }

    const preventExit = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }

    const preventClientLinkNavigation = (event: MouseEvent) => {
      const anchor = linkFor(event)
      if (!anchor) return
      const destination = navigationUrl(anchor.href)
      if (!destination || !changesPage(destination)) return

      if (confirmNavigation(destination)) {
        // Let the matching history mutation proceed without a second prompt.
        allowedNavigationRef.current = destination.href
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
    }

    let historyTraversalHandled = false
    const releaseForHistoryTraversal = () => {
      if (historyTraversalHandled) return
      historyTraversalHandled = true
      onHistoryTraversalRef.current?.()
    }

    const history = window.history
    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState

    const guardedPushState: History['pushState'] = function (data, unused, url) {
      const destination = navigationUrl(url)
      if (destination && changesPage(destination) && !confirmNavigation(destination)) return
      originalPushState.call(history, data, unused, url)
    }
    const guardedReplaceState: History['replaceState'] = function (data, unused, url) {
      const destination = navigationUrl(url)
      if (destination && changesPage(destination) && !confirmNavigation(destination)) return
      originalReplaceState.call(history, data, unused, url)
    }

    history.pushState = guardedPushState
    history.replaceState = guardedReplaceState
    window.addEventListener('beforeunload', preventExit)
    window.addEventListener('popstate', releaseForHistoryTraversal)
    document.addEventListener('click', preventClientLinkNavigation, true)

    return () => {
      window.removeEventListener('beforeunload', preventExit)
      window.removeEventListener('popstate', releaseForHistoryTraversal)
      document.removeEventListener('click', preventClientLinkNavigation, true)
      if (history.pushState === guardedPushState) history.pushState = originalPushState
      if (history.replaceState === guardedReplaceState) history.replaceState = originalReplaceState
      allowedNavigationRef.current = null
    }
  }, [active])

  return { allowNextNavigation }
}
