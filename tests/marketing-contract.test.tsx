// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

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

import LandingPage from '@/app/page'

function renderLandingPage(): string {
  const { container } = render(<LandingPage />)
  return container.textContent ?? ''
}

describe('public marketing contract', () => {
  it('shows the six stable response categories in an explicitly static sample', () => {
    renderLandingPage()

    expect(screen.getByText('Sample Interview result')).toBeInTheDocument()
    const categories = within(screen.getByRole('list', { name: 'Sample result categories' }))
    for (const category of [
      'Fluency',
      'Clarity',
      'Vocabulary',
      'Grammar',
      'Structure',
      'Delivery',
    ]) {
      expect(categories.getByText(category)).toBeInTheDocument()
    }
  })

  it('covers every practice mode, library and custom prompts, and the retry loop', () => {
    const copy = renderLandingPage()

    for (const mode of ['General Practice', 'Interviews', 'Presentations', 'Conversations']) {
      expect(copy).toContain(mode)
    }
    expect(copy).toMatch(/library prompt/i)
    expect(copy).toMatch(/custom prompt/i)
    expect(screen.getByRole('heading', { name: 'Try Again' })).toBeInTheDocument()
    expect(copy).toContain('Record the same prompt again')
  })

  it('keeps every claim response-level and removes retired or prohibited framing', () => {
    const copy = renderLandingPage()

    expect(copy).toContain('Practice one response at a time')
    expect(copy).toContain('The result measures this response')
    expect(copy).not.toMatch(/What you said|How you sounded|50\s*\/\s*50/i)
    expect(copy).not.toMatch(/never (?:comments on|checks|evaluates).*(?:grammar|words)/i)
    expect(copy).not.toMatch(/\b(?:accent|confidence|personality|phoneme|native speaker)\b/i)
    expect(copy).not.toMatch(/guarantee|always makes|never makes/i)
  })

  it('keeps the existing public account entry points', () => {
    renderLandingPage()

    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Answer your first prompt' })).toHaveAttribute(
      'href',
      '/login',
    )
  })
})
