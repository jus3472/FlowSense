// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LastScore } from '@/components/home/last-score'
import { attemptHref, isProtectedPath } from '@/lib/routes'
import { historyHref, parseHistoryQuery } from '@/lib/results/history'

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

describe('attempt navigation', () => {
  it.each(['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'])(
    'uses one canonical legacy and v2 result URL for %s',
    (id) => {
      expect(attemptHref(id)).toBe(`/attempts/${id}`)
    },
  )

  it('renders a returned complete attempt as Last Response', () => {
    render(
      <LastScore
        attemptId="10000000-0000-4000-8000-000000000001"
        score={84}
        summary="Filler words cost the most."
        focusPhrase="in everyday speaking"
      />,
    )
    expect(screen.getByRole('link', { name: /Last response/ })).toHaveAttribute(
      'href',
      '/attempts/10000000-0000-4000-8000-000000000001',
    )
  })

  it('links a returned scoreless snapshot with neutral copy and no fabricated score', () => {
    render(
      <LastScore
        attemptId="20000000-0000-4000-8000-000000000002"
        score={null}
        summary={null}
        focusPhrase="in everyday speaking"
      />,
    )
    expect(screen.getByRole('link', { name: /Last response/ })).toHaveAttribute(
      'href',
      '/attempts/20000000-0000-4000-8000-000000000002',
    )
    expect(screen.getByText('Overall unavailable')).toBeInTheDocument()
    expect(screen.queryByText('/ 100')).not.toBeInTheDocument()
  })

  it('renders no stale link when deletion or an empty query returns no row', () => {
    render(<LastScore attemptId={null} score={null} summary={null} focusPhrase="in practice" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('No score yet')).toBeInTheDocument()
  })

  it('does not link a malformed latest snapshot as a valid result', () => {
    render(
      <LastScore
        attemptId={null}
        score={null}
        summary={null}
        focusPhrase="in practice"
        unavailable
      />,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Last response unavailable')).toBeInTheDocument()
  })

  it('keeps Home selection owned, lifecycle-complete, and free of removed result routes', () => {
    const home = readFileSync('src/app/(app)/home/page.tsx', 'utf8')
    const homeServer = readFileSync('src/lib/home/server.ts', 'utf8')
    const lastScore = readFileSync('src/components/home/last-score.tsx', 'utf8')
    expect(homeServer).toContain(".eq('user_id', userId)")
    expect(home).toContain('loadHomeResponseData(supabase, user.id)')
    expect(home).not.toContain("from('attempts')")
    expect(home).not.toContain(".or('score.not.is.null,section_scores.not.is.null')")
    expect(lastScore).toContain('attemptHref(attemptId)')
    expect(`${home}\n${lastScore}`).not.toMatch(/(?:href=|redirect\()["'`]\/results/)
  })

  it('keeps History query failures distinct from the successful empty state', () => {
    const page = readFileSync('src/app/(app)/history/page.tsx', 'utf8')
    expect(page).toContain("historyResult.status === 'failure'")
    expect(page).toContain('title="Your history did not load"')
    expect(page).toContain('<RetryButton />')
    expect(page).not.toContain('attemptsResult.data ?? []')
  })

  it('keeps missing and cross-user IDs on the owned not-found boundary', () => {
    const page = readFileSync('src/app/(app)/attempts/[id]/page.tsx', 'utf8')
    expect(page).toContain(".eq('id', id)")
    expect(page).toContain(".eq('user_id', user.id)")
    expect(page).toContain('if (!attempt) notFound()')
  })
})

describe('history query navigation', () => {
  it('validates filters and canonicalizes default parameters', () => {
    expect(parseHistoryQuery({})).toEqual({
      status: 'valid',
      query: { metadata: 'all', page: 1 },
    })
    expect(parseHistoryQuery({ show: 'custom', score: 'low', page: '2' })).toEqual({
      status: 'valid',
      query: { metadata: 'custom', page: 2 },
      canonical: true,
    })
    expect(parseHistoryQuery({ score: 'high' })).toEqual({
      status: 'valid',
      query: { metadata: 'all', page: 1 },
      canonical: true,
    })
    expect(historyHref({ metadata: 'all', page: 1 })).toBe('/history')
    expect(historyHref({ metadata: 'retry', page: 3 })).toBe('/history?show=retry&page=3')
  })

  it.each([
    { show: 'unknown' },
    { score: 'best' },
    { page: '0' },
    { page: '-1' },
    { page: '100000' },
    { show: ['custom', 'retry'] },
    { score: ['high'] },
  ])('rejects malformed or repeated query parameters', (params) => {
    expect(parseHistoryQuery(params)).toEqual({ status: 'invalid' })
  })
})

describe('protected route prefixes', () => {
  it.each(['/progress', '/progress/details', '/attempts/id', '/history/page'])(
    'protects %s',
    (pathname) => expect(isProtectedPath(pathname)).toBe(true),
  )

  it.each(['/progressive', '/history-book', '/attempt', '/public/progress'])(
    'does not overmatch %s',
    (pathname) => expect(isProtectedPath(pathname)).toBe(false),
  )
})
