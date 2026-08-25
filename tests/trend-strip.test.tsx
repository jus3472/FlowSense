// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrendStrip } from '@/components/home/trend-strip'

describe('TrendStrip', () => {
  it('stays hidden before the first scored response', () => {
    const { container } = render(<TrendStrip scores={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows a lightweight empty state after one scored response', () => {
    render(<TrendStrip scores={[72]} />)

    expect(screen.getByText('Recent scores')).toBeInTheDocument()
    expect(screen.getByText('latest 72')).toHaveClass('whitespace-nowrap')
    expect(screen.getByText('Your first score is ready')).toBeInTheDocument()
    expect(screen.getByText('Record one more response to see your trend.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('draws the trend after two scored responses', () => {
    render(<TrendStrip scores={[72, 84]} />)

    expect(
      screen.getByRole('img', { name: 'Recent scores from oldest to latest: 72, 84' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Record one more response to see your trend.'),
    ).not.toBeInTheDocument()
  })

  it('keeps mixed 2- and 3-digit labels on stable mobile lanes', () => {
    render(<TrendStrip scores={[8, 12, 47, 73, 88, 99, 100]} />)

    expect(screen.getByText('latest 100')).toHaveClass('whitespace-nowrap')
    for (const score of ['8', '12', '47', '73', '88', '99', '100']) {
      expect(screen.getByText(score)).toHaveClass('min-w-6', 'text-center')
    }
  })
})
