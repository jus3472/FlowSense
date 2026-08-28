// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CurriculumStars } from '@/components/curriculum/stars'
import { curriculumLessonHref, curriculumPathHref } from '@/lib/curriculum/routes'

describe('curriculum route helpers', () => {
  it('builds canonical structured path and lesson routes', () => {
    expect(curriculumPathHref('interviews')).toBe('/practice/paths/interviews')
    expect(curriculumLessonHref('presentations', 'presentations-beginner-01-open')).toBe(
      '/practice/paths/presentations/lessons/presentations-beginner-01-open',
    )
  })
})

describe('curriculum stars', () => {
  it.each([0, 1, 2, 3] as const)('renders %i earned stars with one readable label', (stars) => {
    const { container } = render(<CurriculumStars stars={stars} />)

    expect(screen.getByRole('img', { name: `${stars} of 3 stars` })).toBeInTheDocument()
    expect(container.textContent).toBe(`${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`)
  })
})
