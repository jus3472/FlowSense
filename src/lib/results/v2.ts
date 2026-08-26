import type { Segment } from '@/lib/results/highlights'
import type { PracticeMode, SkillCategory } from '@/lib/practice/contracts'
import type { V2PersistedCategoryScore, V2ScorePayload } from '@/lib/scoring/v2/assemble'

export const V2_CATEGORY_ORDER = [
  'fluency',
  'clarity',
  'vocabulary',
  'grammar',
  'structure',
  'delivery',
] as const satisfies readonly SkillCategory[]

export const V2_CATEGORY_LABELS: Record<SkillCategory, string> = {
  fluency: 'Fluency',
  clarity: 'Clarity',
  vocabulary: 'Vocabulary',
  grammar: 'Grammar',
  structure: 'Structure',
  delivery: 'Delivery',
}

export interface V2CategoryView {
  category: SkillCategory
  label: string
  result: V2PersistedCategoryScore
}

export function v2CategoryViews(payload: V2ScorePayload): V2CategoryView[] {
  return V2_CATEGORY_ORDER.map((category) => ({
    category,
    label: V2_CATEGORY_LABELS[category],
    result: payload.categories[category],
  }))
}

function scoredCategories(payload: V2ScorePayload): V2CategoryView[] {
  return v2CategoryViews(payload).filter(
    ({ result }) => result.status === 'scored' && result.component !== null,
  )
}

export function strongestV2Category(payload: V2ScorePayload): V2CategoryView | null {
  return scoredCategories(payload).reduce<V2CategoryView | null>((best, candidate) => {
    if (!best || candidate.result.component! > best.result.component!) return candidate
    return best
  }, null)
}

export function priorityV2Category(payload: V2ScorePayload): V2CategoryView | null {
  return scoredCategories(payload)
    .filter(({ result }) => result.component! < 1)
    .reduce<V2CategoryView | null>((priority, candidate) => {
      if (!priority || candidate.result.component! < priority.result.component!) return candidate
      return priority
    }, null)
}

export function v2ModeFeedback(mode: PracticeMode): string {
  const feedback: Record<PracticeMode, string> = {
    practice: 'Use this response to choose one thing to try in your next answer.',
    interview: 'Use this response to make your next interview answer easier to follow.',
    presentation: 'Use this response to make your next presentation point easier to follow.',
    conversation: 'Use this response to keep your next conversation response clear and direct.',
  }
  return feedback[mode]
}

export function formatV2Measurements(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, number | boolean] =>
        typeof entry[1] === 'number' || typeof entry[1] === 'boolean',
    )
    .map(([key, measurement]) => {
      const label = key.replaceAll('_', ' ')
      if (typeof measurement === 'boolean') return `${label}: ${measurement ? 'yes' : 'no'}`
      return `${label}: ${Number.isInteger(measurement) ? measurement : measurement.toFixed(2)}`
    })
}

function deductionEvidence(payload: V2ScorePayload) {
  return v2CategoryViews(payload).flatMap(({ label, result }) => {
    if (
      result.status !== 'scored' ||
      result.earned_points === null ||
      result.earned_points >= result.max_points
    ) {
      return []
    }
    return result.evidence
      .filter((evidence) => evidence.source === 'transcript' && typeof evidence.quote === 'string')
      .map((evidence) => ({ label, quote: evidence.quote!.trim(), detail: evidence.detail }))
  })
}

/** A stored deduction observation is the only source for the compact takeaway. */
export function v2EvidenceTakeaway(payload: V2ScorePayload): string | null {
  return (
    deductionEvidence(payload).find((evidence) => evidence.detail.trim().length > 0)?.detail ?? null
  )
}

/**
 * V2 evidence offsets come from multiple providers and units. Match quoted
 * transcript evidence instead, claiming each occurrence once in stored order.
 */
export function v2TranscriptSegments(transcript: string, payload: V2ScorePayload): Segment[] {
  const ranges: Array<{ from: number; to: number; label: string }> = []
  let searchFrom = 0
  for (const evidence of deductionEvidence(payload)) {
    if (!evidence.quote) continue
    const from = transcript
      .toLocaleLowerCase()
      .indexOf(evidence.quote.toLocaleLowerCase(), searchFrom)
    if (from === -1) continue
    const to = from + evidence.quote.length
    ranges.push({ from, to, label: `${evidence.label}: ${evidence.detail}` })
    searchFrom = to
  }

  const segments: Segment[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.from > cursor)
      segments.push({ type: 'text', text: transcript.slice(cursor, range.from) })
    segments.push({
      type: 'highlight',
      text: transcript.slice(range.from, range.to),
      kind: 'word_choice',
      label: range.label,
    })
    cursor = range.to
  }
  if (cursor < transcript.length || segments.length === 0) {
    segments.push({ type: 'text', text: transcript.slice(cursor) })
  }
  return segments
}
