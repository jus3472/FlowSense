// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { PageTitle } from '@/components/ui/page-title'

describe('major page titles', () => {
  it('uses one shared display treatment', () => {
    render(<PageTitle>History</PageTitle>)

    expect(screen.getByRole('heading', { name: 'History', level: 1 })).toHaveClass(
      'prompt-display',
      'text-2xl',
    )
  })

  it.each([
    ['src/app/(app)/home/page.tsx', 'Home'],
    ['src/components/curriculum/home-overview.tsx', 'Home'],
    ['src/app/(app)/history/page.tsx', 'History'],
    ['src/components/progress/progress-dashboard.tsx', 'Progress'],
    ['src/app/(app)/settings/page.tsx', 'Settings'],
  ])('%s renders %s through PageTitle', (path, title) => {
    const source = readFileSync(path, 'utf8')
    expect(source).toContain("import { PageTitle } from '@/components/ui/page-title'")
    expect(source).toContain(
      `<PageTitle${path.includes('home-overview') ? ' id="home-heading"' : ''}>${title}</PageTitle>`,
    )
  })

  it('keeps the Progress introduction to one primary title', () => {
    const dashboard = readFileSync('src/components/progress/progress-dashboard.tsx', 'utf8')

    expect(dashboard).toContain('<PageTitle>Progress</PageTitle>')
    expect(dashboard).not.toContain('Your progress')
    expect(dashboard).not.toContain('Track progress')
    expect(dashboard).not.toContain('Path progress')
  })
})

describe('shared page surfaces', () => {
  it('uses a responsive page rhythm and the requested content width', () => {
    const { container } = render(<PageShell width="reading">Content</PageShell>)

    expect(container.firstChild).toHaveClass(
      'mx-auto',
      'w-full',
      'min-w-0',
      'max-w-reading',
      'gap-12',
    )
  })

  it('renders grouped content with the shared quiet surface treatment', () => {
    render(<Card>Grouped content</Card>)

    expect(screen.getByText('Grouped content')).toHaveClass(
      'border-border',
      'bg-surface',
      'shadow-card',
      'rounded-card',
    )
  })

  it('uses the shared wide canvas for authenticated app chrome', () => {
    const styles = readFileSync('src/app/globals.css', 'utf8')
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8')
    const header = readFileSync('src/components/layout/app-header.tsx', 'utf8')

    expect(styles).toContain('--container-wide: 1200px')
    expect(layout).toContain('className="max-w-wide')
    expect(header).toContain('className="max-w-wide')
  })
})
