// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PracticePage from '@/app/(app)/practice/page'

const REDIRECT = new Error('redirect')
const mocks = vi.hoisted(() => ({
  loadOverview: vi.fn(),
  redirect: vi.fn(() => {
    throw REDIRECT
  }),
  refresh: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/curriculum/server', () => ({
  loadAuthenticatedCurriculumOverview: mocks.loadOverview,
}))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Practice overview page states', () => {
  it.each([
    {
      reason: 'query',
      operation: 'preferences',
      description: 'The connection to your practice paths failed. Try loading them again.',
    },
    {
      reason: 'invalid_response',
      operation: 'preferences',
      description: 'Your saved path information could not be read. Try loading it again.',
    },
  ] as const)(
    'renders a retryable error for a $reason preference failure',
    async ({ description, ...failure }) => {
      mocks.loadOverview.mockResolvedValue({ status: 'failure', ...failure })

      render(await PracticePage())

      expect(
        screen.getByRole('heading', { name: 'Your practice paths did not load' }),
      ).toBeInTheDocument()
      expect(screen.getByText(description)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Your paths' })).not.toBeInTheDocument()
    },
  )

  it('redirects an unauthenticated request before rendering path content', async () => {
    mocks.loadOverview.mockResolvedValue({ status: 'unauthenticated' })

    await expect(PracticePage()).rejects.toBe(REDIRECT)
    expect(mocks.redirect).toHaveBeenCalledWith('/login')
  })
})
