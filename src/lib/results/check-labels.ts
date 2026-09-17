import type { V3MetricId } from '@/lib/scoring/v3/contracts'

const CONTENT_LABELS: Partial<Record<V3MetricId, Readonly<Record<string, string>>>> = {
  answered_prompt: {
    no_prompt_answer: 'Prompt coverage',
    incomplete_prompt_coverage: 'Prompt coverage',
  },
  specificity: {
    missing_detail: 'Details and examples',
    unsupported_claim: 'Support and reasons',
    missing_reason: 'Support and reasons',
    missing_outcome: 'Outcomes',
  },
  structure: {
    unclear_order: 'Order of ideas',
    incomplete_arc: 'Order of ideas',
    scattered_ideas: 'Grouping ideas',
    misplaced_information: 'Grouping ideas',
  },
  conciseness: {
    filler: 'Fillers and restarts',
    false_start: 'Fillers and restarts',
    repeated_idea: 'Repeated ideas',
    redundant_sentence: 'Repeated ideas',
    irrelevant_content: 'Relevance',
    unnecessary_tangent: 'Relevance',
    unnecessary_qualifier: 'Extra wording',
  },
  word_choice: {
    vague_wording: 'Precision',
    imprecise_wording: 'Precision',
    inappropriate_wording: 'Context fit',
  },
  grammar: { grammatical_error: 'Sentence clarity' },
}

export function contentCheckLabel(metric: V3MetricId, kind: string): string | null {
  return CONTENT_LABELS[metric]?.[kind] ?? (metric === 'grammar' ? 'Sentence clarity' : null)
}

export const WORD_CLARITY_LABEL = 'Word clarity'
export const SUSTAINED_EXPRESSION_LABEL = 'Sustained expression'
export const PAUSE_CHECK_LABELS = {
  beginning: 'Before you begin',
  mid_thought: 'Within ideas',
  natural_boundary: 'Between ideas',
} as const
