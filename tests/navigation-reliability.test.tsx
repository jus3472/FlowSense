import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { attemptHref, isProtectedPath } from '@/lib/routes'
import { historyHref, parseHistoryQuery } from '@/lib/results/history'

describe('attempt navigation', () => {
  it.each(['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'])(
    'uses one canonical legacy and v2 result URL for %s',
    (id) => {
      expect(attemptHref(id)).toBe(`/attempts/${id}`)
    },
  )

  it('keeps Home focused on curriculum and free of the removed latest-result query', () => {
    const home = readFileSync('src/app/(app)/home/page.tsx', 'utf8')
    expect(home).not.toContain('loadHomeResponseData')
    expect(home).not.toContain('Latest response')
    expect(home).not.toContain("from('attempts')")
    expect(home).not.toContain(".or('score.not.is.null,section_scores.not.is.null')")
    expect(home).not.toMatch(/(?:href=|redirect\()["'`]\/results/)
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
