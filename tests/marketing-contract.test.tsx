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
  it('shows the current two response sections in an explicitly static sample', () => {
    renderLandingPage()

    expect(screen.getByText('Sample Interview result')).toBeInTheDocument()
    const sections = within(screen.getByRole('list', { name: 'Sample result sections' }))
    for (const section of ['What You Said', 'How You Sounded']) {
      expect(sections.getByText(section)).toBeInTheDocument()
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

    expect(
      screen.getByRole('heading', { name: 'Speak more clearly, one response at a time.' }),
    ).toBeInTheDocument()
    expect(copy).toContain('The result measures this response')
    expect(copy).toContain('Review what you said, how you sounded')
    expect(copy).not.toMatch(/Fluency, Clarity|six categories/i)
    expect(copy).not.toMatch(/50\s*\/\s*50/i)
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
    for (const link of screen.getAllByRole('link', { name: 'Log in' })) {
      expect(link).toHaveAttribute('href', '/login?mode=login')
    }
  })
})
