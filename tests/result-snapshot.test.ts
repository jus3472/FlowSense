import { describe, expect, it } from 'vitest'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'
import { v3Snapshot } from './helpers/result-snapshots'

describe('stored result snapshot decoding', () => {
  it('decodes only exact current v3.score.2 snapshots', () => {
    expect(decodeStoredSectionSnapshot(v3Snapshot())).toMatchObject({
      kind: 'v3',
      payload: { version: 'v3.score.2', rubric_version: 'v3' },
    })
  })

  it('keeps a missing result distinct', () => {
    expect(decodeStoredSectionSnapshot(null)).toEqual({ kind: 'none' })
  })

  it.each([
    ['v2.score.1', 'v2'],
    ['v3.score.1', 'v3'],
    ['v3.score.99', 'v3'],
    ['future.score.1', 'future'],
  ])('fails closed for unsupported %s snapshots', (version, rubricVersion) => {
    expect(
      decodeStoredSectionSnapshot({
        ...v3Snapshot(),
        version,
        rubric_version: rubricVersion,
      }),
    ).toEqual({ kind: 'unsupported_version', scoreVersion: version, rubricVersion })
  })

  it.each([
    undefined,
    [],
    {},
    { version: 'v3.score.2' },
    { ...v3Snapshot(), total_earned_points: 101 },
  ])('rejects malformed data without reinterpretation', (value) => {
    expect(decodeStoredSectionSnapshot(value)).toEqual({ kind: 'malformed' })
  })
})
