// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountdownStep } from '@/components/record/countdown-step'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('CountdownStep', () => {
  it('completes normally after the configured countdown', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    render(
      <CountdownStep promptText="Describe your weekend." seconds={3} onComplete={onComplete} />,
    )

    act(() => vi.advanceTimersByTime(2_900))
    expect(onComplete).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(100))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('starts immediately and cancels the remaining countdown', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    render(
      <CountdownStep promptText="Describe your weekend." seconds={8} onComplete={onComplete} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    expect(onComplete).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(8_000))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('starts exactly once when the button and timer race', () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    render(
      <CountdownStep promptText="Describe your weekend." seconds={3} onComplete={onComplete} />,
    )

    act(() => vi.advanceTimersByTime(3_000))
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    expect(onComplete).toHaveBeenCalledOnce()
  })
})
