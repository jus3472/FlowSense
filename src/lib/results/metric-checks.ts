import type { PracticeMode } from '@/lib/practice/contracts'
import { conversationalFeedback, feedbackSentence } from '@/lib/results/feedback-copy'
import {
  contentCheckLabel,
  PAUSE_CHECK_LABELS,
  SUSTAINED_EXPRESSION_LABEL,
  WORD_CLARITY_LABEL,
} from '@/lib/results/check-labels'
import { v3MetricDetails, v3MetricSummary, type V3MetricFindingView } from '@/lib/results/v3'
import { AUDIO_THRESHOLDS_BY_MODE } from '@/lib/scoring/v3/audio'
import type {
  V3MetricId,
  V3PersistedMetricScore,
  WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'

export interface MetricCheck {
  label: string
  status: 'clear' | 'deduction' | 'issue' | 'unavailable'
  findings: readonly MetricCheckFinding[]
}

export interface MetricCheckFinding extends V3MetricFindingView {
  quotesLabel?: string
}

export interface MetricChecksView {
  summary: string
  checks: readonly MetricCheck[]
}

interface ContentCheckDefinition {
  label: string
  kinds: readonly string[]
  clear: string
  suggestion: string
}

// These group the existing rubric findings. They are explanations, not new
// sub-scores or a requirement to include every type of detail in every response.
const CONTENT_CHECKS: Record<WhatYouSaidMetricId, readonly ContentCheckDefinition[]> = {
  answered_prompt: [
    {
      label: 'Prompt coverage',
      kinds: ['no_prompt_answer', 'incomplete_prompt_coverage'],
      clear: 'You cover the requested parts of the prompt.',
      suggestion: 'Answer each requested part directly.',
    },
  ],
  specificity: [
    {
      label: 'Details and examples',
      kinds: ['missing_detail'],
      clear: 'No gaps in your details stand out here.',
      suggestion: 'Name a specific person, place, action, or example that supports your point.',
    },
    {
      label: 'Support and reasons',
      kinds: ['unsupported_claim', 'missing_reason'],
      clear: 'Your points have the support they need here.',
      suggestion: 'Explain why your point is true with a reason or example.',
    },
    {
      label: 'Outcomes',
      kinds: ['missing_outcome'],
      clear: 'Nothing more is needed about the outcome here.',
      suggestion: 'Explain what happens as a result of the action you describe.',
    },
  ],
  structure: [
    {
      label: 'Order of ideas',
      kinds: ['unclear_order', 'incomplete_arc'],
      clear: 'Your ideas follow a clear order.',
      suggestion: 'Connect your main point, supporting detail, and ending in a clear sequence.',
    },
    {
      label: 'Grouping ideas',
      kinds: ['scattered_ideas', 'misplaced_information'],
      clear: 'Your related ideas stay together.',
      suggestion: 'Keep related points together before moving to the next idea.',
    },
  ],
  conciseness: [
    {
      label: 'Fillers and restarts',
      kinds: ['filler', 'false_start'],
      clear: 'No extra fillers or restarts get in the way here.',
      suggestion: 'Begin with the words that carry your meaning.',
    },
    {
      label: 'Repeated ideas',
      kinds: ['repeated_idea', 'redundant_sentence'],
      clear: 'You keep moving forward without repeating the same point.',
      suggestion: 'Keep the clearest version of the idea and say it once.',
    },
    {
      label: 'Relevance',
      kinds: ['irrelevant_content', 'unnecessary_tangent'],
      clear: 'You stay with details that fit your answer.',
      suggestion: 'Keep the details that help answer the prompt.',
    },
    {
      label: 'Extra wording',
      kinds: ['unnecessary_qualifier'],
      clear: 'No extra qualifiers or closing phrases need trimming.',
      suggestion: 'Remove the phrase if your meaning stays the same without it.',
    },
  ],
  word_choice: [
    {
      label: 'Precision',
      kinds: ['vague_wording', 'imprecise_wording'],
      clear: 'Your wording makes your meaning clear.',
      suggestion: 'Name the specific thing or action you mean.',
    },
    {
      label: 'Context fit',
      kinds: ['inappropriate_wording'],
      clear: 'Your words fit the situation you describe.',
      suggestion: 'Choose wording that fits the situation you describe.',
    },
  ],
  grammar: [
    {
      label: 'Sentence clarity',
      kinds: ['grammatical_error'],
      clear: 'Your grammar keeps your meaning easy to follow.',
      suggestion: 'Rephrase the quoted part to address this grammar issue.',
    },
  ],
}

function finding(observation: string, suggestion: string | null = null): MetricCheckFinding {
  return { key: observation, label: null, quotes: [], observation, suggestion }
}

function check(
  label: string,
  observation: string,
  suggestion: string | null = null,
  status: MetricCheck['status'] = 'unavailable',
): MetricCheck {
  return { label, status, findings: [finding(observation, suggestion)] }
}

function checkStatus(result: V3PersistedMetricScore, issue: boolean | null): MetricCheck['status'] {
  if (result.status !== 'scored' || issue === null) return 'unavailable'
  if (!issue) return 'clear'
  return result.earned_points !== null && result.earned_points < result.max_points
    ? 'deduction'
    : 'issue'
}

function number(result: V3PersistedMetricScore, key: string): number | null {
  const value = result.measurements?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function seconds(ms: number): string {
  return `${Number((ms / 1_000).toFixed(2))} sec`
}

function contentChecks(
  metric: WhatYouSaidMetricId,
  result: V3PersistedMetricScore,
  mode: PracticeMode,
): MetricCheck[] {
  const definitions = CONTENT_CHECKS[metric]
  const details = v3MetricDetails(metric, result, mode)
  const knownKinds = new Set(definitions.flatMap((definition) => definition.kinds))
  // A neutral omission must never become a claim that a response did well.
  const omitted = /^No (?:separate|reliable) issue was counted/.test(result.explanation ?? '')
  return definitions.map((definition, index) => {
    const findings: V3MetricFindingView[] = details.findings
      .filter((_, findingIndex) => {
        const kind = result.details[findingIndex]?.kind ?? ''
        return definition.kinds.includes(kind) || (index === 0 && !knownKinds.has(kind))
      })
      .map((item) => ({
        ...item,
        observation: conversationalFeedback(item.observation),
        suggestion: conversationalFeedback(item.suggestion ?? definition.suggestion),
      }))
    const hasIssue =
      findings.length > 0 || (index === 0 && result.component !== 1 && details.evidence.length > 0)
    if (index === 0) {
      findings.push(...details.evidence.map((item) => finding(item.text)))
    }
    if (findings.length === 0) {
      const observation = omitted
        ? "There isn't enough reliable feedback to suggest a change here."
        : index === 0 && result.component !== 1 && result.details.length === 0
          ? conversationalFeedback(
              result.explanation ?? "We don't have the details for this score.",
            )
          : definition.clear
      findings.push(finding(observation))
    }
    return {
      label: contentCheckLabel(metric, definition.kinds[0] ?? '') ?? definition.label,
      status: checkStatus(
        result,
        hasIssue
          ? true
          : omitted || (result.component !== 1 && result.details.length === 0)
            ? null
            : false,
      ),
      findings,
    }
  })
}

const ENERGY_CHECKS = [
  {
    label: 'Pitch range',
    key: 'pitch_range_component',
    clear: 'Your voice moves comfortably between higher and lower notes.',
    issue: 'Your voice stays in a fairly narrow range.',
    summaryIssue: 'your voice stays in a narrow range',
    suggestion: 'Let your voice rise and fall a little more on the words that matter.',
  },
  {
    label: 'Pitch variation',
    key: 'pitch_variation_component',
    clear: 'Your pitch moves naturally as you speak.',
    issue: 'Your pitch stays fairly even as you speak.',
    summaryIssue: 'your pitch stays fairly even',
    suggestion: 'Let your voice change with the idea, like it does when you tell a friend a story.',
  },
  {
    label: SUSTAINED_EXPRESSION_LABEL,
    key: 'non_monotony_component',
    clear: 'You keep some expression in your voice through most of your answer.',
    issue: 'Your voice stays on the same note for longer stretches.',
    summaryIssue: 'your voice stays flat through longer stretches',
    suggestion: 'Keep a little expression in your voice as you finish each thought.',
  },
  {
    label: 'Speaking rhythm',
    key: 'rhythm_cadence_component',
    clear: 'You give words different amounts of time, keeping your rhythm natural.',
    issue: 'Your words follow a fairly even rhythm.',
    summaryIssue: 'your words follow an even rhythm',
    suggestion: 'Give key words a little more time and let connecting words flow.',
  },
] as const

function audioChecks(
  metric: V3MetricId,
  result: V3PersistedMetricScore,
  mode: PracticeMode,
): Pick<MetricChecksView, 'checks'> {
  const thresholds = AUDIO_THRESHOLDS_BY_MODE[mode]
  if (metric === 'pace') {
    const wpm = number(result, 'words_per_minute')
    const range = thresholds.pace
    const position =
      wpm === null
        ? null
        : wpm < range.full_from_wpm
          ? 'below'
          : wpm > range.full_through_wpm
            ? 'above'
            : 'within'
    const nearBoundary =
      wpm !== null &&
      position !== 'within' &&
      Math.round(wpm) >= range.full_from_wpm &&
      Math.round(wpm) <= range.full_through_wpm
    return {
      checks: [
        check(
          'Speaking pace',
          wpm === null
            ? 'Your speaking rate is unavailable in this result.'
            : `At ${nearBoundary ? 'about ' : ''}${Math.round(wpm)} words per minute, you're ${nearBoundary ? 'just ' : ''}${position} the ${range.full_from_wpm} to ${range.full_through_wpm} range used for this practice.`,
          position === 'above'
            ? 'Give each phrase a little more time.'
            : position === 'below'
              ? 'Move through each phrase a little more steadily.'
              : null,
          checkStatus(result, wpm === null ? null : position !== 'within'),
        ),
      ],
    }
  }
  if (metric === 'paused_time') {
    const total = number(result, 'total_unnatural_pause_ms')
    const fullThrough = thresholds.paused_time.full_through_ms
    const definitions = [
      {
        label: PAUSE_CHECK_LABELS.beginning,
        key: 'beginning_excessive_pause_ms',
        clear: 'You get started without a long wait.',
        issue: 'before your first word',
        suggestion: 'Have your opening phrase ready before you begin.',
      },
      {
        label: PAUSE_CHECK_LABELS.mid_thought,
        key: 'mid_thought_excessive_pause_ms',
        clear: 'You keep each thought moving without long gaps.',
        issue: 'within your ideas',
        suggestion: 'Finish a short phrase before pausing for the next one.',
      },
      {
        label: PAUSE_CHECK_LABELS.natural_boundary,
        key: 'natural_boundary_excessive_pause_ms',
        clear: 'You leave a little breathing room between ideas without lingering.',
        issue: 'between your ideas',
        suggestion: 'Use a brief pause, then continue with your next point.',
      },
    ]
    return {
      checks: definitions.map((definition) => {
        const value = number(result, definition.key)
        return check(
          definition.label,
          value === null
            ? 'Timing for this check is unavailable in this result.'
            : value === 0
              ? definition.clear
              : `You pause longer ${definition.issue}, adding ${seconds(value)} of extra pause time.`,
          value !== null && value > 0 && total !== null && total > fullThrough
            ? definition.suggestion
            : null,
          checkStatus(result, value === null ? null : value > 0),
        )
      }),
    }
  }
  if (metric === 'articulation') {
    const low = number(result, 'low_confidence_word_count')
    const count = number(result, 'eligible_word_count')
    const proportion = number(result, 'low_confidence_proportion')
    const full = thresholds.articulation.full_through_low_proportion
    const observation =
      low === null || count === null || proportion === null
        ? 'Word recognition evidence is unavailable in this result.'
        : low === 0
          ? 'Speech recognition picks up all your checked words clearly.'
          : `Speech recognition is less sure about ${low === 1 ? 'one word' : `${low} words`} in your answer. ${result.earned_points === result.max_points ? (low === 1 ? "That one uncertain word doesn't lower your score." : "Those few uncertain words don't lower your score.") : 'These less certain words are why this score is lower.'}`
    const item = finding(
      observation,
      proportion !== null && proportion > full
        ? 'Give these words a little more space and finish their sounds.'
        : null,
    )
    item.quotes = [
      ...new Set(
        result.evidence.flatMap((e) =>
          e.coordinate?.space === 'transcript' && e.quote ? [e.quote] : [],
        ),
      ),
    ]
    item.quotesLabel = 'Less clear words:'
    return {
      checks: [
        {
          label: WORD_CLARITY_LABEL,
          status: checkStatus(result, low === null ? null : low > 0),
          findings: [item],
        },
      ],
    }
  }
  return {
    checks: ENERGY_CHECKS.map((definition) => {
      const value = number(result, definition.key)
      return check(
        definition.label,
        value === null
          ? 'This vocal check is unavailable in this result.'
          : value === 1
            ? definition.clear
            : definition.issue,
        value !== null && value < 1 ? definition.suggestion : null,
        checkStatus(result, value === null ? null : value < 1),
      )
    }),
  }
}

function scoreSummary(
  metric: V3MetricId,
  result: V3PersistedMetricScore,
  mode: PracticeMode,
): string {
  if (result.status !== 'scored')
    return conversationalFeedback(v3MetricSummary(metric, result, mode))
  if (Object.hasOwn(CONTENT_CHECKS, metric)) {
    const primary = result.details[0]
    if (primary) {
      const sentence = feedbackSentence(primary.observation)
      // A short deictic finding needs its quote to make sense while collapsed.
      const quote = primary.quote
      return quote && quote.length <= 32 && /^(This|That|These|Those|It)\b/.test(sentence)
        ? `“${quote}”: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`
        : sentence
    }
    if (/^No (?:separate|reliable) issue was counted/.test(result.explanation ?? '')) {
      return "There isn't enough reliable feedback to suggest a change here."
    }
    return feedbackSentence(result.explanation ?? 'No specific issue stands out in this check.')
  }
  if (metric === 'pace') {
    const wpm = number(result, 'words_per_minute')
    if (wpm === null) return "We don't have your speaking rate for this result."
    const range = AUDIO_THRESHOLDS_BY_MODE[mode].pace
    const rate = Math.round(wpm)
    if (wpm >= range.full_from_wpm && wpm <= range.full_through_wpm) {
      return `Your pace stays in range at ${rate} words per minute.`
    }
    const direction = wpm < range.full_from_wpm ? 'below' : 'above'
    return result.earned_points === result.max_points
      ? `At about ${rate} words per minute, you're just ${direction} the range, but close enough to keep full points.`
      : `At ${rate} words per minute, your pace is ${direction} the range for this practice.`
  }
  if (metric === 'paused_time') {
    const total = number(result, 'total_unnatural_pause_ms')
    if (total === null) return "We don't have the pause timing for this result."
    if (total === 0)
      return 'You get started promptly and leave no long gaps within or between ideas.'
    const locations = [
      { key: 'beginning_excessive_pause_ms', label: 'before you begin' },
      { key: 'mid_thought_excessive_pause_ms', label: 'within your ideas' },
      { key: 'natural_boundary_excessive_pause_ms', label: 'between your ideas' },
    ]
      .map((item) => ({ ...item, value: number(result, item.key) ?? 0 }))
      .sort((a, b) => b.value - a.value)
    const location = locations[0]
    const where = location && location.value > 0 ? `, mostly ${location.label}` : ''
    const duration = seconds(total).replace(' sec', ' seconds')
    return result.earned_points === result.max_points
      ? `Your pauses add just ${duration} of extra time, small enough to keep full points.`
      : `Longer pauses add ${duration} of extra time${where}.`
  }
  if (metric === 'articulation') {
    const low = number(result, 'low_confidence_word_count')
    const count = number(result, 'eligible_word_count')
    if (low === null || count === null)
      return "We don't have the word clarity details for this result."
    if (low === 0) return `Speech recognition picks up all ${count} checked words clearly.`
    return result.earned_points === result.max_points
      ? `Speech recognition picks up ${count - low} of ${count} checked words clearly, enough to keep full points.`
      : `Speech recognition is less sure about ${low} of ${count} checked words, which lowers this score.`
  }
  const signals = ENERGY_CHECKS.map((definition) => ({
    definition,
    value: number(result, definition.key),
  }))
  if (signals.some((signal) => signal.value === null))
    return "Some vocal details for this score aren't available."
  const weak = signals
    .filter((signal) => signal.value !== null && signal.value < 1)
    .sort((a, b) => (a.value ?? 1) - (b.value ?? 1))
    .slice(0, 2)
  if (weak.length === 0) return 'Your pitch and rhythm vary naturally throughout your answer.'
  const reason = weak.map((signal) => signal.definition.summaryIssue).join(' and ')
  const ending =
    result.earned_points === result.max_points
      ? ', but the difference is small enough to keep full points.'
      : '.'
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}${ending}`
}

/** Explain immutable stored scores without regrading or adding numeric sub-scores. */
export function metricChecks(
  metric: V3MetricId,
  result: V3PersistedMetricScore,
  mode: PracticeMode,
): MetricChecksView {
  const content = Object.hasOwn(CONTENT_CHECKS, metric)
  const view = content
    ? { checks: contentChecks(metric as WhatYouSaidMetricId, result, mode) }
    : audioChecks(metric, result, mode)
  if (result.status !== 'scored') {
    return {
      summary: scoreSummary(metric, result, mode),
      checks: view.checks.map(({ label }) =>
        check(
          label,
          result.status === 'not_checked'
            ? 'This check could not be completed.'
            : 'There is not enough reliable evidence for this check.',
        ),
      ),
    }
  }
  return { ...view, summary: scoreSummary(metric, result, mode) }
}
