import type { PracticeMode } from '@/lib/practice/contracts'

const V2_WEIGHTS: Record<PracticeMode, Record<string, number>> = {
  practice: { fluency: 22, clarity: 20, vocabulary: 12, grammar: 12, structure: 18, delivery: 16 },
  interview: { fluency: 18, clarity: 22, vocabulary: 14, grammar: 12, structure: 22, delivery: 12 },
  presentation: {
    fluency: 16,
    clarity: 20,
    vocabulary: 14,
    grammar: 10,
    structure: 20,
    delivery: 20,
  },
  conversation: {
    fluency: 24,
    clarity: 22,
    vocabulary: 12,
    grammar: 12,
    structure: 14,
    delivery: 16,
  },
}

const WHAT_WEIGHTS: Record<PracticeMode, Record<string, number>> = {
  practice: {
    answered_prompt: 10,
    specificity: 9,
    structure: 9,
    conciseness: 8,
    word_choice: 7,
    grammar: 7,
  },
  interview: {
    answered_prompt: 12,
    specificity: 11,
    structure: 10,
    conciseness: 6,
    word_choice: 6,
    grammar: 5,
  },
  presentation: {
    answered_prompt: 9,
    specificity: 9,
    structure: 12,
    conciseness: 7,
    word_choice: 7,
    grammar: 6,
  },
  conversation: {
    answered_prompt: 9,
    specificity: 8,
    structure: 7,
    conciseness: 10,
    word_choice: 8,
    grammar: 8,
  },
}

const SOUNDED_WEIGHTS: Record<PracticeMode, Record<string, number>> = {
  practice: { pace: 12, time_to_first_word: 5, paused_time: 10, articulation: 13, energy: 10 },
  interview: { pace: 10, time_to_first_word: 6, paused_time: 9, articulation: 15, energy: 10 },
  presentation: { pace: 12, time_to_first_word: 3, paused_time: 9, articulation: 11, energy: 15 },
  conversation: { pace: 11, time_to_first_word: 4, paused_time: 10, articulation: 15, energy: 10 },
}

export const legacySectionSnapshot = {
  content: {
    earned: 50,
    max: 50,
    checks: { answered: 14, explained: 12, word_choice: 12, logical_order: 7, no_repetition: 5 },
  },
  delivery: {
    earned: 50,
    max: 50,
    metrics: { fillers: 18, mid_sentence_pauses: 14, energy: 8, pace: 6, time_to_first_word: 4 },
  },
}

export function obsoleteV2Snapshot(
  options: {
    mode?: PracticeMode
    component?: number
    notCheckedCategory?: string
  } = {},
) {
  const mode = options.mode ?? 'practice'
  const component = options.component ?? 0.8
  const categories = Object.fromEntries(
    Object.entries(V2_WEIGHTS[mode]).map(([category, max]) => [
      category,
      category === options.notCheckedCategory
        ? {
            category,
            availability: 'available',
            status: 'not_checked',
            component: null,
            earned_points: null,
            max_points: max,
            measurements: {},
            evidence: [],
            deductions: [],
            warnings: ['Not checked.'],
          }
        : {
            category,
            availability: 'available',
            status: 'scored',
            component,
            earned_points: Math.round(component * max),
            max_points: max,
            measurements: {},
            evidence: [],
            deductions: [],
            warnings: [],
          },
    ]),
  )
  const complete = Object.values(categories).every((item) => item.status === 'scored')
  return {
    version: 'v2.score.1',
    rubric_version: 'v2',
    mode,
    total_earned_points: complete
      ? Object.values(categories).reduce((sum, item) => sum + (item.earned_points ?? 0), 0)
      : null,
    total_max_points: 100,
    categories,
    warnings: [],
  }
}

function metric(metricId: string, maxPoints: number, component: number) {
  return {
    metric: metricId,
    status: 'scored',
    component,
    earned_points: Math.round(component * maxPoints),
    max_points: maxPoints,
    explanation: `You have visible ${metricId} evidence.`,
    measurements: {},
    evidence: [],
    details: [],
    warnings: [],
  }
}

export function obsoleteV3Snapshot(options: { mode?: PracticeMode; component?: number } = {}) {
  const mode = options.mode ?? 'practice'
  const component = options.component ?? 0.8
  const whatMetrics = Object.fromEntries(
    Object.entries(WHAT_WEIGHTS[mode]).map(([id, max]) => [id, metric(id, max, component)]),
  )
  const soundedMetrics = Object.fromEntries(
    Object.entries(SOUNDED_WEIGHTS[mode]).map(([id, max]) => [id, metric(id, max, component)]),
  )
  const section = (sectionId: string, metrics: Record<string, ReturnType<typeof metric>>) => ({
    section: sectionId,
    status: 'scored',
    earned_points: Object.values(metrics).reduce((sum, item) => sum + item.earned_points, 0),
    max_points: 50,
    metrics,
  })
  const what = section('what_you_said', whatMetrics)
  const sounded = section('how_you_sounded', soundedMetrics)
  return {
    version: 'v3.score.1',
    rubric_version: 'v3',
    mode,
    total_earned_points: what.earned_points + sounded.earned_points,
    total_max_points: 100,
    sections: { what_you_said: what, how_you_sounded: sounded },
    recommendation: {
      strongest_metric: 'answered_prompt',
      weakest_metric: 'energy',
      text: 'You answer the prompt. Keep your energy steady.',
    },
    warnings: [],
  }
}
