import { describe, expect, it } from 'vitest'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'
import { legacySectionSnapshot, v2Snapshot } from './helpers/result-snapshots'

describe('stored result snapshot decoder', () => {
  it('recognizes strict legacy snapshots independently', () => {
    const result = decodeStoredSectionSnapshot(legacySectionSnapshot)

    expect(result).toEqual({ kind: 'legacy', sections: legacySectionSnapshot })
  })

  it('recognizes complete and partial supported v2 snapshots', () => {
    expect(decodeStoredSectionSnapshot(v2Snapshot()).kind).toBe('v2')
    expect(decodeStoredSectionSnapshot(v2Snapshot({ notCheckedCategory: 'grammar' })).kind).toBe(
      'v2',
    )
    expect(decodeStoredSectionSnapshot(v2Snapshot({ unavailableCategory: 'clarity' })).kind).toBe(
      'v2',
    )
  })

  it('classifies future payload and rubric versions explicitly', () => {
    const supported = v2Snapshot()

    expect(decodeStoredSectionSnapshot({ ...supported, version: 'v3.score.1' })).toMatchObject({
      kind: 'unsupported_version',
      scoreVersion: 'v3.score.1',
    })
    expect(decodeStoredSectionSnapshot({ ...supported, rubric_version: 'v3' })).toMatchObject({
      kind: 'unsupported_version',
      rubricVersion: 'v3',
    })
  })

  it('fails closed for malformed current or unversioned snapshots', () => {
    const supported = v2Snapshot()
    const missingCategory = { ...supported.categories }
    delete (missingCategory as Partial<typeof missingCategory>).grammar
    const { total_earned_points: _total, ...missingTotal } = supported

    expect(decodeStoredSectionSnapshot({ ...supported, categories: missingCategory })).toEqual({
      kind: 'malformed',
    })
    expect(decodeStoredSectionSnapshot(missingTotal)).toEqual({ kind: 'malformed' })
    expect(decodeStoredSectionSnapshot({ content: { earned: 50 } })).toEqual({
      kind: 'malformed',
    })
    expect(decodeStoredSectionSnapshot({ ...supported, version: null })).toEqual({
      kind: 'malformed',
    })
    expect(decodeStoredSectionSnapshot(null)).toEqual({ kind: 'none' })
  })

  it('never falls a future version through to a legacy-like interpretation', () => {
    expect(
      decodeStoredSectionSnapshot({
        ...legacySectionSnapshot,
        version: 'v3.score.1',
        rubric_version: 'v3',
      }).kind,
    ).toBe('unsupported_version')
  })
})
