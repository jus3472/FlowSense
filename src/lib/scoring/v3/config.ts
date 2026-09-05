import { PRACTICE_MODES, type PracticeMode } from '@/lib/practice/contracts'
import {
  HOW_YOU_SOUNDED_METRICS,
  V3_RUBRIC_VERSION,
  V3_SCORE_PAYLOAD_VERSION,
  WHAT_YOU_SAID_METRICS,
  type HowYouSoundedMetricId,
  type WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'

export interface V3ModeScoringConfig {
  version: typeof V3_RUBRIC_VERSION
  mode: PracticeMode
  sections: {
    what_you_said: Readonly<Record<WhatYouSaidMetricId, number>>
    how_you_sounded: Readonly<Record<HowYouSoundedMetricId, number>>
  }
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}

function validWeights(value: object, metrics: readonly string[]): boolean {
  if (!exactKeys(value, metrics)) return false
  const values = Object.values(value)
  return (
    values.every((weight) => Number.isInteger(weight) && weight > 0) &&
    values.reduce<number>((total, weight) => total + Number(weight), 0) === 50
  )
}

export function isValidV3ModeScoringConfig(value: unknown): value is V3ModeScoringConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Partial<V3ModeScoringConfig>
  const sections = candidate.sections
  return (
    candidate.version === V3_RUBRIC_VERSION &&
    typeof candidate.mode === 'string' &&
    (PRACTICE_MODES as readonly string[]).includes(candidate.mode) &&
    typeof sections === 'object' &&
    sections !== null &&
    exactKeys(sections, ['what_you_said', 'how_you_sounded']) &&
    typeof sections.what_you_said === 'object' &&
    sections.what_you_said !== null &&
    validWeights(sections.what_you_said, WHAT_YOU_SAID_METRICS) &&
    typeof sections.how_you_sounded === 'object' &&
    sections.how_you_sounded !== null &&
    validWeights(sections.how_you_sounded, HOW_YOU_SOUNDED_METRICS)
  )
}

function config(
  mode: PracticeMode,
  whatYouSaid: Record<WhatYouSaidMetricId, number>,
  howYouSounded: Record<HowYouSoundedMetricId, number>,
): V3ModeScoringConfig {
  const value = {
    version: V3_RUBRIC_VERSION,
    mode,
    sections: Object.freeze({
      what_you_said: Object.freeze({ ...whatYouSaid }),
      how_you_sounded: Object.freeze({ ...howYouSounded }),
    }),
  } satisfies V3ModeScoringConfig
  if (!isValidV3ModeScoringConfig(value)) {
    throw new Error(`The ${mode} v3 scoring configuration is invalid.`)
  }
  return Object.freeze(value)
}

export const V3_MODE_CONFIGS: Readonly<Record<PracticeMode, V3ModeScoringConfig>> = Object.freeze({
  practice: config(
    'practice',
    {
      answered_prompt: 10,
      specificity: 9,
      structure: 9,
      conciseness: 8,
      word_choice: 7,
      grammar: 7,
    },
    { pace: 12, paused_time: 15, articulation: 13, energy: 10 },
  ),
  interview: config(
    'interview',
    {
      answered_prompt: 12,
      specificity: 11,
      structure: 10,
      conciseness: 6,
      word_choice: 6,
      grammar: 5,
    },
    { pace: 10, paused_time: 15, articulation: 15, energy: 10 },
  ),
  presentation: config(
    'presentation',
    {
      answered_prompt: 9,
      specificity: 9,
      structure: 12,
      conciseness: 7,
      word_choice: 7,
      grammar: 6,
    },
    { pace: 12, paused_time: 12, articulation: 11, energy: 15 },
  ),
  conversation: config(
    'conversation',
    {
      answered_prompt: 9,
      specificity: 8,
      structure: 7,
      conciseness: 10,
      word_choice: 8,
      grammar: 8,
    },
    { pace: 11, paused_time: 14, articulation: 15, energy: 10 },
  ),
})

export const V3_SCORING_DEFINITION = Object.freeze({
  scorePayloadVersion: V3_SCORE_PAYLOAD_VERSION,
  rubricVersion: V3_RUBRIC_VERSION,
  modeConfigs: V3_MODE_CONFIGS,
})

/** Free Practice and Custom Prompt both resolve to practice unless a mode is explicitly selected. */
export function v3ConfigFor(mode?: PracticeMode | null): V3ModeScoringConfig {
  return V3_MODE_CONFIGS[mode ?? 'practice']
}
