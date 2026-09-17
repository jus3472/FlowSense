// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StreakDisplay } from '@/components/home/streak-display'

describe('compact header streak presentation', () => {
  it('shows an active streak and complete daily goal, including provider-neutral activity', () => {
    render(
      <StreakDisplay
        summary={{
          current: 12,
          todayActive: true,
          timezone: 'America/New_York',
          today: '2026-08-28',
          dailyGoal: 'complete',
        }}
      />,
    )

    const status = screen.getByRole('button', {
      name: "12 day streak. Today's practice complete.",
    })
    expect(status).toHaveTextContent('12')
    expect(status).toHaveClass('bg-accent', 'text-accent-fg')
    expect(status).toHaveAttribute('data-today-active', 'true')
    expect(status.querySelectorAll('svg')).toHaveLength(2)
  })

  it('keeps yesterday anchored while today remains incomplete', () => {
    render(
      <StreakDisplay
        summary={{
          current: 4,
          todayActive: false,
          timezone: 'UTC',
          today: '2026-08-28',
          dailyGoal: 'incomplete',
        }}
      />,
    )

    const status = screen.getByRole('button', {
      name: "4 day streak. Today's practice not complete.",
    })
    expect(status).toHaveTextContent('4')
    expect(status).toHaveAttribute('data-today-active', 'false')
    expect(status.querySelectorAll('svg')).toHaveLength(1)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.focus(status)
    expect(screen.getByRole('tooltip')).toHaveTextContent('4 day streak')
    fireEvent.keyDown(status, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.click(status)
    expect(screen.getByRole('tooltip')).toHaveTextContent("Today's practice not complete")
    fireEvent.blur(status)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.pointerEnter(status.parentElement!, { pointerType: 'mouse' })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerLeave(status.parentElement!)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    // A touch click need not focus a button (for example, on mobile Safari).
    fireEvent.click(status)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.click(status)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.click(status)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
