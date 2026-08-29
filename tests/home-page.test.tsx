// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadActivity: vi.fn(),
  loadCurriculum: vi.fn(),
  loadResponses: vi.fn(),
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
vi.mock('@/lib/activity/server', () => ({
  loadPracticeActivitySummary: mocks.loadActivity,
}))
vi.mock('@/lib/curriculum/server', () => ({
  loadCurriculumOverviewForUser: mocks.loadCurriculum,
}))
vi.mock('@/lib/home/progression', () => ({
  buildHomeCurriculumModel: mocks.buildCurriculum,
}))
vi.mock('@/lib/home/server', () => ({
  loadHomeResponseData: mocks.loadResponses,
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
      href: '/practice/paths/interviews/lessons/interviews-beginner-01',
    },
    passedLessons: 0,
    totalLessons: 30,
    earnedStars: 0,
    maximumStars: 90,
  },
  secondary: [],
}

const activity = {
  status: 'ready' as const,
  data: {
    current: 2,
    todayActive: true,
    timezone: 'America/New_York',
    today: '2026-08-28',
    dailyGoal: 'complete' as const,
  },
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
  mocks.loadActivity.mockResolvedValue(activity)
  mocks.loadCurriculum.mockResolvedValue({ status: 'ready', data: { paths: [] } })
  mocks.buildCurriculum.mockReturnValue(curriculumModel)
  mocks.loadResponses.mockResolvedValue({
    status: 'ready',
    data: {
      latest: null,
      latestUnavailable: false,
      recentPromptIds: [],
      scores: [],
      timestamps: [],
    },
  })
})

describe('Home data orchestration', () => {
  it('loads activity, progression, and latest response from the same owned client', async () => {
    const client = supabaseClient()
    mocks.createClient.mockResolvedValue(client)

    render(await HomePage())

    expect(mocks.loadActivity).toHaveBeenCalledWith(client, 'user-1')
    expect(mocks.loadCurriculum).toHaveBeenCalledWith(client, 'user-1')
    expect(mocks.loadResponses).toHaveBeenCalledWith(client, 'user-1')
    expect(screen.getByText('2 day streak')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Continue Interviews' })).toBeInTheDocument()
  })

  it('keeps progression and practice links safe when response history fails', async () => {
    mocks.loadResponses.mockResolvedValue({ status: 'failure', reason: 'query' })

    render(await HomePage())

    expect(screen.getByRole('heading', { name: 'Continue Interviews' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Free Practice' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your responses did not load' })).toBeInTheDocument()
    expect(
      screen.getByText('The connection to your account failed. Your recordings are safe.'),
    ).toBeInTheDocument()
  })

  it('renders neutral stored-data copy for an invalid latest-response snapshot', async () => {
    mocks.loadResponses.mockResolvedValue({ status: 'failure', reason: 'invalid_response' })

    render(await HomePage())

    expect(
      screen.getByText('Your saved response summary could not be read. Try loading it again.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/connection to your account/i)).not.toBeInTheDocument()
  })

  it('keeps activity, alternatives, and latest response visible when curriculum fails', async () => {
    mocks.loadCurriculum.mockResolvedValue({
      status: 'failure',
      reason: 'query',
      operation: 'overview',
    })
    mocks.loadResponses.mockResolvedValue({
      status: 'ready',
      data: {
        latest: {
          attemptId: 'attempt-1',
          score: 81,
          summary: 'This response has 81 of 100 points.',
        },
        latestUnavailable: false,
        recentPromptIds: [],
        scores: [81],
        timestamps: [],
      },
    })

    render(await HomePage())

    expect(screen.getByText("Today's practice complete")).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your path did not load' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Free Practice' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Last response/ })).toHaveAttribute(
      'href',
      '/attempts/attempt-1',
    )
    expect(screen.getByText('81')).toBeInTheDocument()
  })

  it('keeps the primary path and responses visible when activity fails', async () => {
    mocks.loadActivity.mockResolvedValue({ status: 'failure', reason: 'query' })

    render(await HomePage())

    expect(
      screen.getByRole('heading', { name: 'Your practice days did not load' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Continue Interviews' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Latest response' })).toBeInTheDocument()
  })
})
