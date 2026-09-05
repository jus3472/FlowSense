import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { ProgressDashboard } from '@/components/progress/progress-dashboard'
import { aggregateV3Progress } from '@/lib/progress/v3-aggregation'
import { progressAttempt, v3Snapshot } from './helpers/result-snapshots'

const NOW = new Date('2026-09-05T12:00:00.000Z')

function dashboard(sectionScores: unknown = v3Snapshot()) {
  return {
    progress: aggregateV3Progress(
      [progressAttempt('attempt-1', '2026-09-04T12:00:00.000Z', sectionScores)],
      { now: NOW },
    ),
    retryComparisons: [],
    coverage: { completedAttemptLimit: 200, truncated: false },
  }
}

describe('ProgressDashboard', () => {
  it('renders the ten current metrics and no retired category trends', () => {
    render(<ProgressDashboard dashboard={dashboard()} />)
    expect(screen.getByRole('heading', { name: 'Current metric trends' })).toBeInTheDocument()
    expect(screen.getByText('Answered the Prompt')).toBeInTheDocument()
    expect(screen.getByText('Paused Time')).toBeInTheDocument()
    expect(screen.getByText('Energy')).toBeInTheDocument()
    expect(screen.queryByText('Time to First Word')).not.toBeInTheDocument()
    expect(screen.queryByText('Earlier category trends')).not.toBeInTheDocument()
  })

  it('shows an empty current view when only unsupported snapshots exist', () => {
    render(
      <ProgressDashboard
        dashboard={dashboard({ ...v3Snapshot(), version: 'v3.score.1' })}
      />,
    )
    expect(screen.getByText('No current progress yet')).toBeInTheDocument()
    expect(screen.getByText(/different or unavailable result format/)).toBeInTheDocument()
  })

  it('keeps the generic query-failure state', () => {
    render(<ProgressDashboard dashboard={null} />)
    expect(screen.getByText('Speaking skill progress is unavailable')).toBeInTheDocument()
  })
})
// @vitest-environment jsdom
