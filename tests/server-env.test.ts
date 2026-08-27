import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { audioDebugRouteEnabled } from '@/lib/env/server'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('server environment boundaries', () => {
  it.each([
    ['development', true],
    ['test', true],
    ['production', false],
    ['staging', false],
  ])('sets audio debug availability for %s', (environment, expected) => {
    vi.stubEnv('NODE_ENV', environment)
    expect(audioDebugRouteEnabled()).toBe(expected)
  })
})
