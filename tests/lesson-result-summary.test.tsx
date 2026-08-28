// @vitest-environment jsdom

import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LessonResultSummary } from '@/components/curriculum/lesson-result-summary'
import type { StructuredLessonResultModel } from '@/lib/curriculum/result'

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

function result(overrides: Partial<StructuredLessonResultModel> = {}): StructuredLessonResultModel {
  return {
    attemptId: 'current-attempt',
    state: 'passed',
    currentScore: 84,
    currentStars: 2,
    bestScore: 84,
    bestStars: 2,
    bestAttemptId: 'current-attempt',
    personalBest: true,
    path: { slug: 'general-speaking', title: 'General Speaking' },
    chapter: { level: 'beginner', title: 'Beginner' },
    lesson: {
      id: 'lesson-6',
      slug: 'general-speaking-beginner-06-setback',
      title: 'Handling a setback',
      position: 6,
      checkpoint: false,
    },
    nextLesson: { level: 'beginner', position: 7 },
    pathComplete: false,
    primaryAction: {
      label: 'Continue',
      href: '/practice/paths/general-speaking/lessons/general-speaking-beginner-07-next',
    },
    secondaryAction: {
      label: 'Retry for 3 stars',
      href: '/practice/paths/general-speaking/lessons/general-speaking-beginner-06-setback/record?retry=current-attempt',
    },
    ...overrides,
  }
}

describe('LessonResultSummary', () => {
  it('shows passed context, current stars, authoritative best, and progression actions', () => {
    render(<LessonResultSummary result={result()} />)

    expect(
      screen.getByRole('heading', { name: 'Handling a setback', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lesson complete' })).toBeInTheDocument()
    expect(screen.getAllByText('84')).toHaveLength(2)
    expect(screen.getAllByLabelText('2 of 3 stars')).toHaveLength(2)
    expect(screen.getByText(/Best:/)).toHaveTextContent('Best: 84')
    expect(screen.getByText('Personal best')).toBeInTheDocument()
    expect(screen.getByText('Lesson 7 is available.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/practice/paths/general-speaking/lessons/general-speaking-beginner-07-next',
    )
    expect(screen.getByRole('link', { name: 'Retry for 3 stars' })).toHaveAttribute(
      'href',
      expect.stringContaining('?retry=current-attempt'),
    )
  })

  it('shows a below-threshold result without Continue', () => {
    render(
      <LessonResultSummary
        result={result({
          state: 'not_passed',
          currentScore: 69,
          currentStars: 0,
          bestScore: 69,
          bestStars: 0,
          primaryAction: {
            label: 'Try Again',
            href: '/practice/paths/general-speaking/lessons/general-speaking-beginner-06-setback/record?retry=current-attempt',
          },
          secondaryAction: null,
        })}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Lesson not passed' })).toBeInTheDocument()
    expect(screen.getByText('Need 70 to continue.')).toBeInTheDocument()
    expect(screen.getAllByLabelText('0 of 3 stars')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Try Again' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('shows neutral copy, no current score or stars, and preserves an earlier best', () => {
    render(
      <LessonResultSummary
        result={result({
          state: 'neutral',
          currentScore: null,
          currentStars: 0,
          bestScore: 86,
          bestStars: 2,
          bestAttemptId: null,
          personalBest: false,
          primaryAction: {
            label: 'Try Again',
            href: '/practice/paths/general-speaking/lessons/general-speaking-beginner-06-setback/record?retry=current-attempt',
          },
          secondaryAction: null,
        })}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Result unavailable' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Some checks could not be completed, so this attempt does not affect your lesson progress.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Best:/)).toHaveTextContent('Best: 86')
    expect(screen.getAllByLabelText('2 of 3 stars')).toHaveLength(1)
    expect(screen.queryByText('/ 100')).not.toBeInTheDocument()
    expect(screen.queryByText('Personal best')).not.toBeInTheDocument()
  })

  it('shows restrained final path completion with View Path', () => {
    render(
      <LessonResultSummary
        result={result({
          lesson: {
            id: 'lesson-30',
            slug: 'general-speaking-advanced-10-checkpoint',
            title: 'Advanced checkpoint',
            position: 10,
            checkpoint: true,
          },
          chapter: { level: 'advanced', title: 'Advanced' },
          nextLesson: null,
          pathComplete: true,
          primaryAction: {
            label: 'View Path',
            href: '/practice/paths/general-speaking',
          },
        })}
      />,
    )

    expect(screen.getByText('Path complete')).toBeInTheDocument()
    expect(screen.getByText('You passed every lesson in General Speaking.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Path' })).toHaveAttribute(
      'href',
      '/practice/paths/general-speaking',
    )
  })
})
