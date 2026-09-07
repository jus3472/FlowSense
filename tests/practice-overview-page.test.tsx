import { beforeEach, describe, expect, it, vi } from 'vitest'

const REDIRECT = new Error('redirect')
const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw REDIRECT
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import PracticePage from '@/app/(app)/practice/page'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('legacy practice overview route', () => {
  it('redirects to the canonical Home overview', () => {
    expect(() => PracticePage()).toThrow(REDIRECT)
    expect(mocks.redirect).toHaveBeenCalledWith('/home')
  })
})
