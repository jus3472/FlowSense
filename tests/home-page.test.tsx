// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/components/curriculum/home-overview', () => ({
  HomeOverview: () => <div>Four track overview</div>,
}))

import HomePage, { metadata } from '@/app/(app)/home/page'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Home overview page states', () => {
  it('uses Home metadata and renders the curriculum overview as the canonical destination', async () => {
    mocks.loadOverview.mockResolvedValue({ status: 'ready', data: { paths: [] } })

    render(await HomePage())

    expect(metadata).toMatchObject({ title: 'Home' })
    expect(mocks.loadOverview).toHaveBeenCalledOnce()
    expect(screen.getByText('Four track overview')).toBeInTheDocument()
  })

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
    'renders a retryable Home error for a $reason preference failure',
    async ({ description, ...failure }) => {
      mocks.loadOverview.mockResolvedValue({ status: 'failure', ...failure })

      render(await HomePage())

      expect(
        screen.getByRole('heading', { name: 'Your practice paths did not load' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Home', level: 1 })).toHaveClass(
        'prompt-display',
        'text-2xl',
      )
      expect(screen.getByText(description)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    },
  )

  it('redirects an unauthenticated request before rendering path content', async () => {
    mocks.loadOverview.mockResolvedValue({ status: 'unauthenticated' })

    await expect(HomePage()).rejects.toBe(REDIRECT)
    expect(mocks.redirect).toHaveBeenCalledWith('/login')
  })
})
