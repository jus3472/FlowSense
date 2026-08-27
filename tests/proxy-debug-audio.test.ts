import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  audioDebugRouteEnabled: vi.fn(),
  updateSession: vi.fn(),
}))

vi.mock('@/lib/env/server', () => ({
  audioDebugRouteEnabled: mocks.audioDebugRouteEnabled,
}))
vi.mock('@/lib/supabase/session', () => ({ updateSession: mocks.updateSession }))

import proxy from '@/proxy'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateSession.mockImplementation((request: NextRequest) =>
    NextResponse.redirect(new URL('/login', request.url)),
  )
})

describe('audio debug proxy boundary', () => {
  it.each(['/debug/audio', '/debug/audio/'])(
    'returns a production 404 for %s without auth or redirect work',
    async (pathname) => {
      mocks.audioDebugRouteEnabled.mockReturnValue(false)

      const response = await proxy(new NextRequest(`https://flowsense.example${pathname}`))

      expect(response.status).toBe(404)
      expect(response.headers.get('location')).toBeNull()
      expect(mocks.updateSession).not.toHaveBeenCalled()
    },
  )

  it.each(['development', 'test'])(
    'keeps normal authentication for %s debug requests',
    async () => {
      mocks.audioDebugRouteEnabled.mockReturnValue(true)
      const request = new NextRequest('https://flowsense.example/debug/audio')

      const response = await proxy(request)

      expect(mocks.updateSession).toHaveBeenCalledExactlyOnceWith(request)
      expect(response.headers.get('location')).toBe('https://flowsense.example/login')
    },
  )

  it.each(['/debug/audio-tools', '/debugging/audio', '/public/debug/audio'])(
    'does not overmatch the unrelated path %s',
    async (pathname) => {
      mocks.audioDebugRouteEnabled.mockReturnValue(false)
      const request = new NextRequest(`https://flowsense.example${pathname}`)

      const response = await proxy(request)

      expect(mocks.updateSession).toHaveBeenCalledExactlyOnceWith(request)
      expect(response.headers.get('location')).toBe('https://flowsense.example/login')
    },
  )
})
