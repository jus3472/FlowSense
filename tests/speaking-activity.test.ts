import {
  classifySpeakingActivity,
  isSpeakingActivity,
  type SpeakingActivityInput,
} from '@/lib/activity/speaking'
import { legacySectionSnapshot, v2Snapshot } from './helpers/result-snapshots'
import { describe, expect, it } from 'vitest'

function activity(overrides: Partial<SpeakingActivityInput> = {}): SpeakingActivityInput {
  const sectionScores = v2Snapshot({ component: 0.8 })
  return {
    status: 'done',
    durationMs: 1,
    transcript: 'One measured response.',
    score: sectionScores.total_earned_points,
    sectionScores,
    ...overrides,
  }
}

describe('speaking activity classification', () => {
  it('accepts a structurally valid matching numeric v2 result below passing', () => {
    const sectionScores = v2Snapshot({ component: 0.4 })
    const result = classifySpeakingActivity(
      activity({ score: sectionScores.total_earned_points, sectionScores }),
    )

    expect(result).toEqual({
      kind: 'scored',
      score: sectionScores.total_earned_points,
      resultKind: 'v2',
    })
    expect(isSpeakingActivity(result)).toBe(true)
  })

  it('accepts a valid provider-incomplete v2 result as neutral activity', () => {
    const sectionScores = v2Snapshot({ notCheckedCategory: 'grammar' })
    const result = classifySpeakingActivity(activity({ score: null, sectionScores }))

    expect(result).toEqual({ kind: 'neutral', score: null, resultKind: 'v2' })
    expect(isSpeakingActivity(result)).toBe(true)
  })

  it('accepts a valid legacy result with a numeric score', () => {
    expect(
      classifySpeakingActivity(activity({ score: 64, sectionScores: legacySectionSnapshot })),
    ).toEqual({ kind: 'scored', score: 64, resultKind: 'legacy' })
  })

  it.each([
    ['not done', { status: 'scoring' }, 'not_done'],
    ['zero duration', { durationMs: 0 }, 'invalid_duration'],
    ['negative duration', { durationMs: -1 }, 'invalid_duration'],
    ['non-finite duration', { durationMs: Number.NaN }, 'invalid_duration'],
    ['blank transcript', { transcript: '   ' }, 'empty_transcript'],
    ['missing snapshot', { sectionScores: null }, 'missing_result'],
    ['malformed snapshot', { sectionScores: {} }, 'malformed_result'],
  ] as const)('rejects %s', (_label, overrides, reason) => {
    const result = classifySpeakingActivity(activity(overrides))
    expect(result).toEqual({ kind: 'invalid', reason })
    expect(isSpeakingActivity(result)).toBe(false)
  })

  it('rejects unsupported result versions', () => {
    const current = v2Snapshot()
    expect(
      classifySpeakingActivity(activity({ sectionScores: { ...current, version: 'future' } })),
    ).toEqual({ kind: 'invalid', reason: 'unsupported_result' })
  })

  it('rejects numeric v2 scalar mismatch and a synthetic zero for neutral v2', () => {
    const scored = v2Snapshot({ component: 0.8 })
    const neutral = v2Snapshot({ unavailableCategory: 'clarity' })

    expect(classifySpeakingActivity(activity({ score: 79, sectionScores: scored }))).toEqual({
      kind: 'invalid',
      reason: 'score_mismatch',
    })
    expect(classifySpeakingActivity(activity({ score: 0, sectionScores: neutral }))).toEqual({
      kind: 'invalid',
      reason: 'score_mismatch',
    })
  })

  it('rejects missing or malformed legacy scores', () => {
    expect(
      classifySpeakingActivity(activity({ score: null, sectionScores: legacySectionSnapshot })),
    ).toEqual({ kind: 'invalid', reason: 'score_mismatch' })
    expect(
      classifySpeakingActivity(activity({ score: 70.5, sectionScores: legacySectionSnapshot })),
    ).toEqual({ kind: 'invalid', reason: 'score_mismatch' })
  })
})
