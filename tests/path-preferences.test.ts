import { describe, expect, it } from 'vitest'
import {
  buildLoadedPathPreferences,
  legacyFocusAreasForPaths,
  parseSubmittedPathPreferences,
  samePathPreferenceOrder,
} from '@/lib/path-preferences'

const PATHS = [
  {
    id: 'general-id',
    slug: 'general-speaking',
    title: 'General Speaking',
    mode: 'practice',
    position: 1,
    active: true,
  },
  {
    id: 'interviews-id',
    slug: 'interviews',
    title: 'Interviews',
    mode: 'interview',
    position: 2,
    active: true,
  },
  {
    id: 'presentations-id',
    slug: 'presentations',
    title: 'Presentations',
    mode: 'presentation',
    position: 3,
    active: true,
  },
  {
    id: 'conversations-id',
    slug: 'conversations',
    title: 'Conversations',
    mode: 'conversation',
    position: 4,
    active: true,
  },
]

describe('path preference parsing', () => {
  it('uses General Speaking only when the saved preference set is genuinely empty', () => {
    expect(buildLoadedPathPreferences(PATHS, [])).toMatchObject({
      primarySlug: 'general-speaking',
      secondarySlugs: [],
      usedDefaultPreference: true,
    })
  })

  it('preserves one primary and ordered optional secondary paths', () => {
    const loaded = buildLoadedPathPreferences(PATHS, [
      { path_id: 'interviews-id', rank: 0 },
      { path_id: 'presentations-id', rank: 1 },
      { path_id: 'general-id', rank: 2 },
    ])
    expect(loaded).toMatchObject({
      primarySlug: 'interviews',
      secondarySlugs: ['presentations', 'general-speaking'],
      usedDefaultPreference: false,
    })
    expect(
      loaded && samePathPreferenceOrder(loaded, ['interviews', 'presentations', 'general-speaking']),
    ).toBe(true)
  })

  it.each([
    { rows: [{ path_id: 'interviews-id', rank: 1 }] },
    {
      rows: [
        { path_id: 'interviews-id', rank: 0 },
        { path_id: 'interviews-id', rank: 1 },
      ],
    },
    { rows: [{ path_id: 'unknown-id', rank: 0 }] },
    { rows: [{ path_id: 'interviews-id', rank: '0' }] },
  ])('fails closed on malformed stored preference rows', ({ rows }) => {
    expect(buildLoadedPathPreferences(PATHS, rows)).toBeNull()
  })

  it('requires a valid distinct primary and secondary submission', () => {
    expect(parseSubmittedPathPreferences('interviews', ['presentations', 'conversations'])).toEqual([
      'interviews',
      'presentations',
      'conversations',
    ])
    expect(parseSubmittedPathPreferences(null, [])).toBeNull()
    expect(parseSubmittedPathPreferences('interviews', ['interviews'])).toBeNull()
    expect(parseSubmittedPathPreferences('unknown', [])).toBeNull()
  })

  it('maps onboarding paths to stable legacy Free Practice goals', () => {
    expect(legacyFocusAreasForPaths(['conversations', 'general-speaking'])).toEqual([
      'meetings-conversations',
      'general-speaking',
    ])
  })
})
