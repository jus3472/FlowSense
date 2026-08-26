// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { V2ResultsView } from '@/components/results/v2-results-view'
import { V2_SCORE_PAYLOAD_VERSION, type V2ScorePayload } from '@/lib/scoring/v2/assemble'

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

function payload(partial = false): V2ScorePayload {
  const categories = Object.fromEntries(
    [
      ['fluency', 22],
      ['clarity', 20],
      ['vocabulary', 12],
      ['grammar', 12],
      ['structure', 18],
      ['delivery', 16],
    ].map(([category, max]) => [
      category,
      {
        category,
        availability: 'available',
        status: partial && category === 'grammar' ? 'not_checked' : 'scored',
        component: partial && category === 'grammar' ? null : 1,
        earned_points: partial && category === 'grammar' ? null : max,
        max_points: max,
        measurements: {},
        evidence: [],
        deductions: [],
        warnings: [],
      },
    ]),
  ) as V2ScorePayload['categories']
  return {
    version: V2_SCORE_PAYLOAD_VERSION,
    rubric_version: 'v2',
    mode: 'practice',
    total_earned_points: partial ? null : 100,
    total_max_points: 100,
    categories,
    warnings: [],
  }
}

const props = {
  attemptId: 'attempt-1',
  promptText: 'Describe your day.',
  additionalContext: null,
  transcript: 'I took a walk.',
  durationMs: 12_000,
  audioUrl: 'https://example.test/audio',
}

describe('V2ResultsView', () => {
  it('renders a complete result with all categories, audio, and one primary retry action', () => {
    render(<V2ResultsView {...props} payload={payload()} />)
    for (const label of ['Fluency', 'Clarity', 'Vocabulary', 'Grammar', 'Structure', 'Delivery']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('No category lost points in this response.')).toBeInTheDocument()
    expect(screen.getByLabelText('Play Your answer')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Try Again' })).toHaveLength(1)
  })

  it('renders the partial state instead of a fabricated total', () => {
    render(<V2ResultsView {...props} audioUrl={null} payload={payload(true)} />)
    expect(screen.getByText('Some checks are not available')).toBeInTheDocument()
    expect(screen.getByText('Not checked')).toBeInTheDocument()
    expect(
      screen.getByText('Some categories were not checked, so the overall result is unavailable.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('100')).not.toBeInTheDocument()
  })

  it('renders neutral numeric comparison rows and a previous-response link', () => {
    render(
      <V2ResultsView
        {...props}
        payload={payload()}
        comparison={{
          previousAttemptId: 'attempt-0',
          rows: [
            {
              category: 'fluency',
              currentPoints: 20,
              previousPoints: 15,
              maxPoints: 22,
              deltaPoints: 5,
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('Compared with your previous response')).toBeInTheDocument()
    expect(screen.getByText('fluency: 20 / 22 (previously 15, +5)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View previous response' })).toHaveAttribute(
      'href',
      '/attempts/attempt-0',
    )
    expect(screen.queryByText(/improv|worse|better/i)).not.toBeInTheDocument()
  })
})
