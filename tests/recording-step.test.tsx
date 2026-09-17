// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingStep } from '@/components/record/recording-step'

const baseProps = {
  promptText: 'Describe a choice you made.',
  maxDurationMs: 60_000,
  getLevel: () => 0.1,
  onStop: vi.fn(),
}

beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('RecordingStep spoken words', () => {
  it('fades arriving words without moving or resizing them and keeps one accent color', () => {
    const { rerender } = render(
      <RecordingStep
        {...baseProps}
        transcript={{
          finalized: [{ start: 0, text: 'I chose summer.' }],
          interim: 'It feels warm',
        }}
        transcriptUnavailable={false}
      />,
    )

    expect(screen.queryByText('Live transcript')).not.toBeInTheDocument()
    expect(screen.getByRole('log', { name: 'Words as you speak' })).toHaveTextContent(
      'I chose summer. It feels warm',
    )
    expect(screen.getByRole('log', { name: 'Words as you speak' })).toHaveClass(
      'overflow-y-auto',
      'live-transcript-scroll',
      'text-center',
    )
    const words = screen.getByTestId('live-transcript-words')
    expect(words).toHaveTextContent('I chose summer. It feels warm')
    expect(words.parentElement).toHaveClass('text-accent-ink')
    const animatedWords = Array.from(document.querySelectorAll('.animate-transcript-fade'))
    expect(animatedWords).toHaveLength(6)
    for (const word of animatedWords) {
      expect(word).not.toHaveClass('transition-transform', 'transition-[font-size]')
    }

    rerender(
      <RecordingStep
        {...baseProps}
        transcript={{
          finalized: [{ start: 0, text: 'I chose summer. It feels warm.' }],
          interim: '',
        }}
        transcriptUnavailable={false}
      />,
    )
    expect(screen.getByTestId('live-transcript-words')).toHaveTextContent(
      'I chose summer. It feels warm.',
    )
  })

  it('shows mist only at edges with more transcript beyond them', () => {
    const { rerender } = render(
      <RecordingStep
        {...baseProps}
        transcript={{ finalized: [{ start: 0, text: 'One two three four five six' }], interim: '' }}
        transcriptUnavailable={false}
      />,
    )
    const log = screen.getByRole('log', { name: 'Words as you speak' })
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 160 },
    })
    expect(log).toHaveClass('live-transcript-scroll', 'overflow-y-auto', 'py-6')
    expect(screen.queryByTestId('live-transcript-scrollbar')).not.toBeInTheDocument()

    log.scrollTop = 0
    fireEvent.scroll(log)
    expect(log).toHaveAttribute('data-fade-top', 'false')
    expect(log).toHaveAttribute('data-fade-bottom', 'true')

    log.scrollTop = 24
    fireEvent.scroll(log)
    expect(log).toHaveAttribute('data-fade-top', 'true')
    expect(log).toHaveAttribute('data-fade-bottom', 'true')

    rerender(
      <RecordingStep
        {...baseProps}
        transcript={{
          finalized: [{ start: 0, text: 'One two three four five six seven' }],
          interim: '',
        }}
        transcriptUnavailable={false}
      />,
    )
    expect(log.scrollTop).toBe(24)

    log.scrollTop = 160
    fireEvent.scroll(log)
    expect(log).toHaveAttribute('data-fade-top', 'true')
    expect(log).toHaveAttribute('data-fade-bottom', 'false')
  })

  it('shows a plain fallback only when words cannot appear', () => {
    const { rerender } = render(
      <RecordingStep
        {...baseProps}
        transcript={{ finalized: [], interim: '' }}
        transcriptUnavailable={false}
      />,
    )

    expect(screen.getByRole('log', { name: 'Words as you speak' })).toBeEmptyDOMElement()

    rerender(
      <RecordingStep
        {...baseProps}
        transcript={{ finalized: [], interim: '' }}
        transcriptUnavailable
      />,
    )
    expect(
      screen.getByText('Your words are not appearing right now. Your recording continues.'),
    ).toBeInTheDocument()
  })
})
