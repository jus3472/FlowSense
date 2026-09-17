// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ProcessingStep } from '@/components/record/processing-step'

describe('ProcessingStep', () => {
  it('defines the animation used by the processing spinner', () => {
    const styles = readFileSync('src/app/globals.css', 'utf8')
    expect(styles).toContain('--animate-spin: spin 800ms linear infinite')
    expect(styles).toMatch(/@keyframes spin\s*{[\s\S]*transform: rotate\(360deg\)/)
  })

  it.each([
    ['uploading', 'Saving your response'],
    ['transcribing', 'Transcribing your response'],
    ['scoring', 'Reviewing what you said and how you sounded'],
  ] as const)('shows calm activity copy while %s without a recording player', (stage, copy) => {
    const { container } = render(
      <ProcessingStep
        promptText="Describe a clear decision."
        state={{ stage, failedStage: null, message: null }}
        onRetry={() => {}}
      />,
    )

    expect(screen.getByText('Describe a clear decision.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Preparing your feedback' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Preparing your feedback' })).toHaveClass('text-lg')
    expect(screen.getByRole('status')).toHaveTextContent(copy)
    expect(screen.getByRole('status')).toHaveClass('text-base')
    expect(container.querySelector('[data-processing-spinner="true"]')).toHaveClass(
      'size-12',
      'text-accent-visual',
      'animate-spin',
      'motion-reduce:animate-none',
    )
    expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument()
    expect(container.querySelector('.bg-surface')).not.toBeInTheDocument()
    expect(container.querySelector('audio')).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('keeps a failed stage retryable', () => {
    const onRetry = vi.fn()
    render(
      <ProcessingStep
        promptText="Describe a clear decision."
        state={{
          stage: 'failed',
          failedStage: 'transcribing',
          message: 'The transcript could not be prepared.',
        }}
        onRetry={onRetry}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Your transcript could not be prepared' }),
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('The transcript could not be prepared.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
