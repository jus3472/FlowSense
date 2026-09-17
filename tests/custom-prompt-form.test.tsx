// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/actions/custom-practice', () => ({ beginCustomPractice: vi.fn() }))

import { CUSTOM_PROMPT_EXAMPLES, CustomPromptForm } from '@/components/practice/custom-prompt-form'

describe('custom prompt form', () => {
  it('fills the prompt from each clickable example', () => {
    render(<CustomPromptForm />)
    const prompt = screen.getByLabelText('Prompt or question')

    for (const example of CUSTOM_PROMPT_EXAMPLES) {
      fireEvent.click(screen.getByRole('button', { name: example }))
      expect(prompt).toHaveValue(example)
      expect(prompt).toHaveFocus()
    }
  })

  it('explains category and planned response length without collecting context', () => {
    const { container } = render(<CustomPromptForm />)
    expect(screen.getByLabelText('Category')).toHaveAccessibleDescription(
      'Choose where this response appears in History and Progress.',
    )
    expect(screen.getByRole('option', { name: 'Other' })).toBeInTheDocument()
    expect(screen.getByLabelText('Planned response length')).toHaveAccessibleDescription(
      'Choose how long you plan to speak, from 15 to 60 seconds.',
    )
    expect(screen.queryByText(/additional context/i)).not.toBeInTheDocument()
    expect(container.querySelector('[name="additional_context"]')).toBeNull()
  })
})
