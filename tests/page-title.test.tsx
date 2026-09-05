// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
    ['src/components/curriculum/practice-overview.tsx', 'Tracks'],
    ['src/app/(app)/history/page.tsx', 'History'],
    ['src/components/progress/progress-dashboard.tsx', 'Progress'],
  ])('%s renders %s through PageTitle', (path, title) => {
    const source = readFileSync(path, 'utf8')
    expect(source).toContain("import { PageTitle } from '@/components/ui/page-title'")
    expect(source).toContain(
      `<PageTitle${title === 'Tracks' ? ' id="tracks-heading"' : ''}>${title}</PageTitle>`,
    )
  })

  it('keeps the Progress introduction to one primary title', () => {
    const page = readFileSync('src/app/(app)/progress/page.tsx', 'utf8')
    const dashboard = readFileSync('src/components/progress/progress-dashboard.tsx', 'utf8')
    const curriculum = readFileSync('src/components/progress/curriculum-progress.tsx', 'utf8')

    expect(page).toContain('<PageTitle>Progress</PageTitle>')
    expect(dashboard).not.toContain('Your progress')
    expect(curriculum).not.toContain('Path progress')
    expect(curriculum).not.toContain('Your lesson progress stays with each path.')
  })
})
