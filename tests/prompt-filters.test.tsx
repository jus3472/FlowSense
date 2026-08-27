// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PromptFilters } from '@/components/practice/prompt-filters'

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

describe('PromptFilters', () => {
  it('marks selected filters and provides a keyboard-accessible collection clear link', () => {
    render(
      <PromptFilters
        mode="interview"
        difficulty="advanced"
        collectionId="problem_solving"
        collections={[
          { id: 'behavioral', mode: 'interview', promptCount: 2 },
          { id: 'problem_solving', mode: 'interview', promptCount: 1 },
        ]}
      />,
    )

    expect(screen.getByRole('navigation', { name: 'Difficulty' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Collections' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Advanced' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Problem solving' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Clear collection' })).toHaveAttribute(
      'href',
      '/practice/interview?difficulty=advanced',
    )
  })

  it('marks the all choices as current when no filters are selected', () => {
    render(
      <PromptFilters
        mode="practice"
        collections={[{ id: 'storytelling', mode: 'practice', promptCount: 3 }]}
      />,
    )

    expect(screen.getByRole('link', { name: 'All levels' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'All collections' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.queryByRole('link', { name: 'Clear collection' })).not.toBeInTheDocument()
  })

  it('keeps an empty selected collection visible and clearable', () => {
    render(<PromptFilters mode="practice" collectionId="raising_concern" collections={[]} />)

    expect(screen.getByRole('link', { name: 'Raising concern' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Clear collection' })).toHaveAttribute(
      'href',
      '/practice/practice',
    )
  })
})
