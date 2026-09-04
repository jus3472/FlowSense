import { PRACTICE_MODES } from '@/lib/practice/contracts'
import {
  isValidV3ModeScoringConfig,
  V3_MODE_CONFIGS,
  V3_SCORING_DEFINITION,
  v3ConfigFor,
} from '@/lib/scoring/v3/config'
import {
  HOW_YOU_SOUNDED_METRICS,
  V3_METRIC_IDS,
  V3_RUBRIC_VERSION,
  V3_SECTION_IDS,
  WHAT_YOU_SAID_METRICS,
} from '@/lib/scoring/v3/contracts'
import { describe, expect, it } from 'vitest'

const EXPECTED = {
  practice: {
    what_you_said: [10, 9, 9, 8, 7, 7],
    how_you_sounded: [12, 15, 13, 10],
  },
  interview: {
    what_you_said: [12, 11, 10, 6, 6, 5],
    how_you_sounded: [10, 15, 15, 10],
  },
  presentation: {
    what_you_said: [9, 9, 12, 7, 7, 6],
    how_you_sounded: [12, 12, 11, 15],
  },
  conversation: {
    what_you_said: [9, 8, 7, 10, 8, 8],
    how_you_sounded: [11, 14, 15, 10],
  },
} as const

describe('v3 scoring configuration', () => {
  it('defines exactly two sections and ten visible metrics', () => {
    expect(V3_SECTION_IDS).toEqual(['what_you_said', 'how_you_sounded'])
    expect(WHAT_YOU_SAID_METRICS).toHaveLength(6)
    expect(HOW_YOU_SOUNDED_METRICS).toHaveLength(4)
    expect(new Set(V3_METRIC_IDS).size).toBe(10)
  })

  it('locks each mode to its reviewed 50/50 distribution', () => {
    expect(Object.keys(V3_MODE_CONFIGS)).toEqual([...PRACTICE_MODES])
    for (const mode of PRACTICE_MODES) {
      const config = V3_MODE_CONFIGS[mode]
      expect(config.version).toBe(V3_RUBRIC_VERSION)
      expect(config.mode).toBe(mode)
      expect(isValidV3ModeScoringConfig(config)).toBe(true)
      expect(Object.values(config.sections.what_you_said)).toEqual(EXPECTED[mode].what_you_said)
      expect(Object.values(config.sections.how_you_sounded)).toEqual(EXPECTED[mode].how_you_sounded)
      expect(
        Object.values(config.sections.what_you_said).reduce((sum, value) => sum + value, 0),
      ).toBe(50)
      expect(
        Object.values(config.sections.how_you_sounded).reduce((sum, value) => sum + value, 0),
      ).toBe(50)
    }
  })

  it('defaults Free Practice and Custom Prompt callers to General Speaking', () => {
    expect(v3ConfigFor()).toBe(V3_MODE_CONFIGS.practice)
    expect(v3ConfigFor(null)).toBe(V3_MODE_CONFIGS.practice)
    expect(v3ConfigFor('interview')).toBe(V3_MODE_CONFIGS.interview)
  })

  it('rejects missing, additional, noninteger, or incorrectly totaled weights', () => {
    const valid = V3_MODE_CONFIGS.practice
    expect(
      isValidV3ModeScoringConfig({
        ...valid,
        sections: {
          ...valid.sections,
          what_you_said: { ...valid.sections.what_you_said, hidden_quality: 1 },
        },
      }),
    ).toBe(false)
    expect(
      isValidV3ModeScoringConfig({
        ...valid,
        sections: {
          ...valid.sections,
          how_you_sounded: { ...valid.sections.how_you_sounded, energy: 9.5 },
        },
      }),
    ).toBe(false)
    expect(
      isValidV3ModeScoringConfig({
        ...valid,
        sections: {
          ...valid.sections,
          what_you_said: { ...valid.sections.what_you_said, grammar: 6 },
        },
      }),
    ).toBe(false)
  })

  it('freezes every configuration layer', () => {
    const config = V3_MODE_CONFIGS.practice
    expect(Object.isFrozen(V3_MODE_CONFIGS)).toBe(true)
    expect(Object.isFrozen(V3_SCORING_DEFINITION)).toBe(true)
    expect(V3_SCORING_DEFINITION).toMatchObject({
      scorePayloadVersion: 'v3.score.2',
      rubricVersion: 'v3',
    })
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.sections)).toBe(true)
    expect(Object.isFrozen(config.sections.what_you_said)).toBe(true)
    expect(Object.isFrozen(config.sections.how_you_sounded)).toBe(true)
    expect(Reflect.set(config.sections.what_you_said, 'grammar', 50)).toBe(false)
    expect(config.sections.what_you_said.grammar).toBe(7)
  })
})
