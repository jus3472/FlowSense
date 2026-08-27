import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearHandoff: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw { path }
  }),
}))

vi.mock('@/lib/practice/custom-handoff-cookie', () => ({
  clearCustomPracticeHandoffCookie: mocks.clearHandoff,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import { logOut } from '@/actions/auth'

function clientWith(signOut: () => Promise<unknown>) {
  return { auth: { signOut } }
}

beforeEach(() => {
  mocks.clearHandoff.mockReset()
  mocks.createClient.mockReset()
  mocks.redirect.mockClear()
})

describe('logout reliability', () => {
  it('clears the custom handoff and redirects only after sign-out succeeds', async () => {
    const events: string[] = []
    const signOut = vi.fn(async () => {
      events.push('sign_out')
      return { error: null }
    })
    mocks.clearHandoff.mockImplementation(async () => {
      events.push('clear_handoff')
    })
    mocks.createClient.mockResolvedValue(clientWith(signOut))
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(logOut()).rejects.toMatchObject({ path: '/login' })

    expect(events).toEqual(['sign_out', 'clear_handoff'])
    expect(mocks.redirect).toHaveBeenCalledOnce()
    expect(logging).not.toHaveBeenCalled()
  })

  it('keeps a failed session in Settings with a bounded diagnostic', async () => {
    const privateValues = [
      'private auth message',
      'private-cookie',
      'private-token',
      'person@example.test',
    ]
    const signOut = vi.fn(async () => ({
      error: {
        code: 'refresh_token_not_found',
        status: 503,
        message: privateValues[0],
        headers: { cookie: privateValues[1] },
        cause: { token: privateValues[2], email: privateValues[3] },
      },
    }))
    mocks.createClient.mockResolvedValue(clientWith(signOut))
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(logOut()).rejects.toMatchObject({ path: '/settings?logout=failed' })

    expect(mocks.clearHandoff).not.toHaveBeenCalled()
    expect(logging).toHaveBeenCalledOnce()
    expect(logging).toHaveBeenCalledWith('[auth] operation failed', {
      operation: 'sign_out',
      code: 'refresh_token_not_found',
      status: 503,
    })
    const output = JSON.stringify(logging.mock.calls)
    for (const privateValue of privateValues) expect(output).not.toContain(privateValue)
  })

  it('sanitizes thrown auth failures and keeps them recoverable', async () => {
    const privateMessage = 'token and header values must stay private'
    const thrown = Object.assign(new Error(privateMessage), {
      code: 'private-token',
      status: 999,
    })
    mocks.createClient.mockResolvedValue(clientWith(vi.fn().mockRejectedValue(thrown)))
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(logOut()).rejects.toMatchObject({ path: '/settings?logout=failed' })

    expect(logging).toHaveBeenCalledWith('[auth] operation failed', {
      operation: 'sign_out',
      code: 'unknown',
      status: null,
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain(privateMessage)
    expect(JSON.stringify(logging.mock.calls)).not.toContain('private-token')
  })

  it('still reaches login when handoff cleanup fails after successful sign-out', async () => {
    mocks.createClient.mockResolvedValue(clientWith(vi.fn(async () => ({ error: null }))))
    mocks.clearHandoff.mockRejectedValue(new Error('private cleanup details'))
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(logOut()).rejects.toMatchObject({ path: '/login' })

    expect(logging).toHaveBeenCalledWith('[auth] operation failed', {
      operation: 'logout_cleanup',
      code: 'unknown',
      status: null,
    })
    expect(JSON.stringify(logging.mock.calls)).not.toContain('private cleanup details')
  })
})
