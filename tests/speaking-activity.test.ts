import { describe, expect, it } from 'vitest'
import { classifySpeakingActivity, isSpeakingActivity } from '@/lib/activity/speaking'
import { v3Snapshot } from './helpers/result-snapshots'

function activity(overrides: Record<string, unknown> = {}) {
  const sectionScores = v3Snapshot({ component: 0.8 })
  return {
    status: 'done',
    durationMs: 10_000,
    transcript: 'A current response.',
    score: sectionScores.total_earned_points,
    sectionScores,
    ...overrides,
  }
}

describe('speaking activity classification', () => {
  it('accepts current numerical and provider-neutral results', () => {
    expect(classifySpeakingActivity(activity())).toEqual({
      kind: 'scored',
      score: 80,
      resultKind: 'current',
    })
    const neutral = v3Snapshot({ unavailableMetric: 'energy' })
    expect(classifySpeakingActivity(activity({ score: null, sectionScores: neutral }))).toEqual({
      kind: 'neutral',
      score: null,
      resultKind: 'current',
    })
  })

  it.each([
    [{ status: 'failed' }, 'not_done'],
    [{ durationMs: 0 }, 'invalid_duration'],
    [{ transcript: '  ' }, 'empty_transcript'],
    [{ score: 10 }, 'score_mismatch'],
    [{ score: null, sectionScores: null }, 'missing_result'],
    [{ sectionScores: {} }, 'malformed_result'],
    [{ sectionScores: { ...v3Snapshot(), version: 'v3.score.1' } }, 'unsupported_result'],
    [{ sectionScores: { ...v3Snapshot(), version: 'v3.score.99' } }, 'unsupported_result'],
  ])('rejects invalid activity as %s', (overrides, reason) => {
    expect(classifySpeakingActivity(activity(overrides))).toEqual({ kind: 'invalid', reason })
  })

  it('narrows valid activity', () => {
    expect(isSpeakingActivity(classifySpeakingActivity(activity()))).toBe(true)
    expect(isSpeakingActivity(classifySpeakingActivity(activity({ status: 'failed' })))).toBe(false)
  })
})
