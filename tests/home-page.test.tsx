// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadHomeResponseData: vi.fn(),
  logHomeDataFailure: vi.fn(),
  pickPreferredPracticePrompt: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: function MockLink({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/lib/home/server', () => ({
  loadHomeResponseData: mocks.loadHomeResponseData,
  logHomeDataFailure: mocks.logHomeDataFailure,
}))
vi.mock('@/lib/prompts/server', () => ({
  pickPreferredPracticePrompt: mocks.pickPreferredPracticePrompt,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import HomePage from '@/app/(app)/home/page'

function supabaseClient() {
  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: { focus_areas: [] }, error: null })),
  }
  profileQuery.select.mockReturnValue(profileQuery)
  profileQuery.eq.mockReturnValue(profileQuery)
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: vi.fn(() => profileQuery),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue(supabaseClient())
  mocks.pickPreferredPracticePrompt.mockResolvedValue({ status: 'empty' })
})

describe('Home response load failures', () => {
  it('renders connection-specific copy for a query failure', async () => {
    mocks.loadHomeResponseData.mockResolvedValue({ status: 'failure', reason: 'query' })

    render(await HomePage())

    expect(screen.getByRole('heading', { name: 'Your responses did not load' })).toBeInTheDocument()
    expect(
      screen.getByText('The connection to your account failed. Your recordings are safe.'),
    ).toBeInTheDocument()
  })

  it('renders neutral stored-data copy for an invalid response', async () => {
    mocks.loadHomeResponseData.mockResolvedValue({
      status: 'failure',
      reason: 'invalid_response',
    })

    render(await HomePage())

    expect(screen.getByRole('heading', { name: 'Your responses did not load' })).toBeInTheDocument()
    expect(
      screen.getByText('Your saved response summary could not be read. Try loading it again.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/connection to your account/i)).not.toBeInTheDocument()
  })
})
