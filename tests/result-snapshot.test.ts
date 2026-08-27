import { describe, expect, it } from 'vitest'
import { decodeStoredSectionSnapshot } from '@/lib/results/snapshot'
import { legacySectionSnapshot, v2Snapshot } from './helpers/result-snapshots'

function withFluencyFields(fields: Record<string, unknown>): unknown {
  const snapshot = v2Snapshot()
  return {
    ...snapshot,
    categories: {
      ...snapshot.categories,
      fluency: { ...snapshot.categories.fluency, ...fields },
    },
  }
}

function withoutFluencyField(field: string): unknown {
  const snapshot = v2Snapshot()
  const fluency = { ...snapshot.categories.fluency } as Record<string, unknown>
  delete fluency[field]
  return { ...snapshot, categories: { ...snapshot.categories, fluency } }
}

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

  it('preserves historical v2 evidence without coordinate metadata', () => {
    const historical = withFluencyFields({
      evidence: [
        {
          source: 'transcript',
          start: 0,
          end: 2,
          quote: 'um',
          detail: 'Filler detected in the transcript.',
        },
      ],
    })

    expect(decodeStoredSectionSnapshot(historical).kind).toBe('v2')
  })

  it('keeps evolving measurements opaque at the storage boundary', () => {
    expect(
      decodeStoredSectionSnapshot(withFluencyFields({ measurements: ['future', { value: 1 }] }))
        .kind,
    ).toBe('v2')
  })

  it.each([
    ['missing warnings', () => withoutFluencyField('warnings')],
    ['non-array warnings', () => withFluencyFields({ warnings: {} })],
    ['non-string warning', () => withFluencyFields({ warnings: [42] })],
    ['missing evidence', () => withoutFluencyField('evidence')],
    ['non-array evidence', () => withFluencyFields({ evidence: {} })],
    ['malformed evidence item', () => withFluencyFields({ evidence: [null] })],
    ['missing deductions', () => withoutFluencyField('deductions')],
    ['non-array deductions', () => withFluencyFields({ deductions: {} })],
    ['malformed deduction item', () => withFluencyFields({ deductions: [42] })],
    ['malformed deduction fields', () => withFluencyFields({ deductions: [{ detail: 42 }] })],
  ])('fails closed for %s in a current v2 category', (_label, fixture) => {
    expect(() => decodeStoredSectionSnapshot(fixture())).not.toThrow()
    expect(decodeStoredSectionSnapshot(fixture())).toEqual({ kind: 'malformed' })
  })

  it.each([
    ['a missing source', { start: 0, end: 2, quote: 'um', detail: 'Observed.' }],
    ['a missing detail', { source: 'transcript', start: 0, end: 2, quote: 'um' }],
    [
      'a non-string quote',
      { source: 'transcript', start: 0, end: 2, quote: {}, detail: 'Observed.' },
    ],
  ])('fails closed for evidence with %s', (_label, evidence) => {
    expect(decodeStoredSectionSnapshot(withFluencyFields({ evidence: [evidence] }))).toEqual({
      kind: 'malformed',
    })
  })

  it.each([
    [
      'missing top-level warnings',
      () => {
        const { warnings: _warnings, ...snapshot } = v2Snapshot()
        return snapshot
      },
    ],
    ['non-array top-level warnings', () => ({ ...v2Snapshot(), warnings: {} })],
    ['non-string top-level warning', () => ({ ...v2Snapshot(), warnings: [null] })],
  ])('fails closed for %s', (_label, fixture) => {
    expect(decodeStoredSectionSnapshot(fixture())).toEqual({ kind: 'malformed' })
  })

  it.each([
    ['a negative start', { start: -1, end: 2 }],
    ['a reversed range', { start: 4, end: 2 }],
    ['a partially missing range', { start: null, end: 2 }],
    ['a non-finite bound', { start: 0, end: Number.POSITIVE_INFINITY }],
    [
      'fractional transcript coordinates',
      {
        start: 0.5,
        end: 2,
        coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
      },
    ],
    [
      'a transcript quote outside its stated range',
      {
        start: 0,
        end: 2,
        quote: 'longer',
        coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
      },
    ],
    ['an unknown coordinate', { coordinate: { space: 'transcript', unit: 'word' } }],
  ])('fails closed for evidence with %s', (_label, evidenceFields) => {
    const fixture = withFluencyFields({
      evidence: [
        {
          source: 'transcript',
          start: 0,
          end: 2,
          quote: 'um',
          detail: 'Filler detected in the transcript.',
          ...evidenceFields,
        },
      ],
    })

    expect(decodeStoredSectionSnapshot(fixture)).toEqual({ kind: 'malformed' })
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

  it.each(['__proto__', 'constructor', 'prototype', 'toString', ''])(
    'classifies the hostile version key %j as unsupported',
    (key) => {
      const supported = v2Snapshot()

      expect(decodeStoredSectionSnapshot({ ...supported, version: key })).toEqual({
        kind: 'unsupported_version',
        scoreVersion: key,
        rubricVersion: 'v2',
      })
      expect(decodeStoredSectionSnapshot({ ...supported, rubric_version: key })).toEqual({
        kind: 'unsupported_version',
        scoreVersion: 'v2.score.1',
        rubricVersion: key,
      })
    },
  )

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
