// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { Route } from 'next'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { V3ResultsView } from '@/components/results/v3-results-view'
import type { StructuredLessonResultModel } from '@/lib/curriculum/result'
import { V3_METRIC_IDS, V3_METRIC_LABELS } from '@/lib/scoring/v3/contracts'
import { legacyV3Snapshot, v3Snapshot } from './helpers/result-snapshots'

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

const props = {
  attemptId: 'attempt-1',
  promptText: 'Describe a recent choice.',
  additionalContext: null,
  transcript: 'I used a vague phrase.',
  durationMs: 12_000,
  audioUrl: 'https://example.test/audio',
}

const curriculumResult: StructuredLessonResultModel = {
  attemptId: 'attempt-1',
  state: 'passed',
  currentScore: 80,
  currentStars: 2,
  bestScore: 80,
  bestStars: 2,
  bestAttemptId: 'attempt-1',
  personalBest: true,
  path: { slug: 'general-speaking', title: 'General Speaking' },
  chapter: { level: 'beginner', title: 'Beginner' },
  lesson: {
    id: 'lesson-1',
    slug: 'general-speaking-beginner-01-start',
    title: 'Start clearly',
    position: 1,
    checkpoint: false,
  },
  nextLesson: { level: 'beginner', position: 2 },
  pathComplete: false,
  primaryAction: {
    label: 'Continue',
    href: '/practice/paths/general-speaking/lessons/next' as Route,
  },
  secondaryAction: null,
}

describe('V3ResultsView', () => {
  it('renders the required result sections and all ten current metrics in exact order', () => {
    const { container } = render(<V3ResultsView {...props} payload={v3Snapshot()} />)
    const headings = Array.from(container.querySelectorAll('h1, h2')).map((heading) =>
      heading.textContent?.trim(),
    )
    expect(headings).toEqual([
      props.promptText,
      'Transcript',
      'What You Said',
      'How You Sounded',
      'Recording',
    ])
    expect(screen.getAllByText('What You Said')).toHaveLength(1)
    expect(screen.getAllByText('How You Sounded')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: props.promptText, level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('Your prompt')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Overall score' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Recommendation' })).not.toBeInTheDocument()
    expect(screen.getByText(/^You did well at .+ To improve/)).toBeInTheDocument()
    expect(screen.queryByText(/^Based on /)).not.toBeInTheDocument()
    for (const metric of V3_METRIC_IDS) {
      const label = V3_METRIC_LABELS[metric]
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('heading', { name: 'Time to First Word' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Play Your answer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try Again' })).toHaveAttribute(
      'href',
      '/record?retry=attempt-1',
    )
  })

  it('renders a stored v3.score.1 snapshot with its historical first-word metric', () => {
    render(<V3ResultsView {...props} payload={legacyV3Snapshot()} />)

    expect(screen.getByRole('heading', { name: 'Time to First Word' })).toBeInTheDocument()
    expect(screen.getByText(/^Based on /)).toBeInTheDocument()
  })

  it('shows partial score states without a fabricated overall or recommendation', () => {
    render(
      <V3ResultsView
        {...props}
        audioUrl={null}
        payload={v3Snapshot({ notCheckedMetric: 'grammar', unavailableMetric: 'energy' })}
      />,
    )
    expect(screen.getByText('Overall unavailable')).toBeInTheDocument()
    expect(screen.getByText('Not checked / 7')).toBeInTheDocument()
    expect(screen.getByText('Unavailable / 10')).toBeInTheDocument()
    expect(
      screen.getByText('A recommendation is unavailable because some metrics were not scored.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Audio playback is unavailable for this response.',
    )
  })

  it('keeps deduction evidence clickable and uses the cleaned structured result hierarchy', () => {
    const payload = v3Snapshot({
      evidenceMetric: 'word_choice',
      evidence: [
        {
          source: 'transcript',
          start: 9,
          end: 14,
          coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
          quote: 'vague',
          detail: 'This word does not identify the choice.',
        },
      ],
    })
    const { container } = render(
      <V3ResultsView {...props} payload={payload} curriculumResult={curriculumResult} />,
    )
    const prompt = screen.getByText(props.promptText)
    const score = screen.getByRole('region', { name: 'Result summary' }).querySelector('.numeric')
    if (!score) throw new Error('Missing visible score.')
    expect(prompt.compareDocumentPosition(score)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByRole('heading', { name: 'Lesson complete' })).toBeInTheDocument()
    expect(screen.getByText(/Best:/)).toHaveTextContent('Best: 80')
    expect(screen.queryByText('Start clearly')).not.toBeInTheDocument()
    expect(screen.queryByText('Lesson 2 is available.')).not.toBeInTheDocument()
    const mark = screen.getByRole('button', { name: /vague\. Word Choice:/ })
    fireEvent.click(mark)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Word Choice: This word does not identify the choice.',
    )
    expect(container.querySelectorAll('mark')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Try Again' })).not.toBeInTheDocument()
  })

  it('keeps neutral lesson progress explicit without showing a fabricated score', () => {
    render(
      <V3ResultsView
        {...props}
        payload={v3Snapshot({ notCheckedMetric: 'grammar' })}
        curriculumResult={{
          ...curriculumResult,
          state: 'neutral',
          currentScore: null,
          currentStars: 0,
          bestScore: 64,
          bestStars: 0,
          bestAttemptId: 'attempt-0',
          personalBest: false,
          primaryAction: {
            label: 'Try Again',
            href: '/record?retry=attempt-1' as Route,
          },
          secondaryAction: null,
        }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Result unavailable' })).toBeInTheDocument()
    expect(screen.getByText(/Best:/)).toHaveTextContent('Best: 64')
    expect(
      screen.getByText(
        'Some checks could not be completed, so this attempt does not affect your lesson progress.',
      ),
    ).toBeInTheDocument()
  })
})
