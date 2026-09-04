// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadCurriculum: vi.fn(),
  buildCurriculum: vi.fn(),
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
vi.mock('@/lib/curriculum/server', () => ({
  loadCurriculumOverviewForUser: mocks.loadCurriculum,
}))
vi.mock('@/lib/home/progression', () => ({
  buildHomeCurriculumModel: mocks.buildCurriculum,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import HomePage from '@/app/(app)/home/page'

const curriculumModel = {
  primary: {
    pathTitle: 'Interviews',
    heading: 'Continue Interviews',
    pathComplete: false,
    transitionLabel: null,
    chapterLabel: 'Beginner · Lesson 1 of 10',
    lessonTitle: 'Open with a clear answer',
    lessonStatus: 'Not attempted',
    action: {
      label: 'Continue' as const,
      href: '/practice/paths/interviews/lessons/interviews-beginner-01/record',
    },
    passedLessons: 0,
    totalLessons: 30,
    earnedStars: 0,
    maximumStars: 90,
  },
  secondary: [],
}

function supabaseClient() {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue(supabaseClient())
  mocks.loadCurriculum.mockResolvedValue({ status: 'ready', data: { paths: [] } })
  mocks.buildCurriculum.mockReturnValue(curriculumModel)
})

describe('Home data orchestration', () => {
  it('loads owned curriculum without rendering removed response or alternative-practice sections', async () => {
    const client = supabaseClient()
    mocks.createClient.mockResolvedValue(client)

    render(await HomePage())

    expect(mocks.loadCurriculum).toHaveBeenCalledWith(client, 'user-1')
    expect(screen.getByRole('heading', { name: 'Continue Interviews' })).toBeInTheDocument()
    expect(screen.queryByText('Open with a clear answer')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Latest response' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Practice something else' }),
    ).not.toBeInTheDocument()
  })

  it('keeps a retryable curriculum failure state', async () => {
    mocks.loadCurriculum.mockResolvedValue({
      status: 'failure',
      reason: 'query',
      operation: 'overview',
    })

    render(await HomePage())

    expect(screen.getByRole('heading', { name: 'Your path did not load' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Latest response')).not.toBeInTheDocument()
  })
})
