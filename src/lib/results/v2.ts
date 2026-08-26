import type { Segment } from '@/lib/results/highlights'
import type { PracticeMode, SkillCategory } from '@/lib/practice/contracts'
import type { V2PersistedCategoryScore, V2ScorePayload } from '@/lib/scoring/v2/assemble'

interface TranscriptCandidate {
  quote: string
  label: string
  detail: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

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

function hasDeduction(result: V2PersistedCategoryScore, id: string, field = 'id'): boolean {
  return result.deductions.some((deduction) => isRecord(deduction) && deduction[field] === id)
}

function contentCandidates(label: string, result: V2PersistedCategoryScore): TranscriptCandidate[] {
  return result.deductions.flatMap((deduction) => {
    if (
      !isRecord(deduction) ||
      typeof deduction.deduction !== 'number' ||
      deduction.deduction <= 0
    ) {
      return []
    }
    const quote = nonEmptyString(deduction.quote)
    const detail = nonEmptyString(deduction.observation)
    const hasValidatedEvidence =
      Array.isArray(deduction.evidence) &&
      deduction.evidence.some(
        (evidence) =>
          isRecord(evidence) &&
          typeof evidence.start === 'number' &&
          typeof evidence.end === 'number' &&
          evidence.end > evidence.start,
      )
    return quote && detail && hasValidatedEvidence ? [{ quote, detail, label }] : []
  })
}

function deductionEvidence(payload: V2ScorePayload): TranscriptCandidate[] {
  return v2CategoryViews(payload).flatMap(({ category, label, result }) => {
    if (result.status !== 'scored') return []
    if (category === 'grammar' || category === 'vocabulary' || category === 'structure') {
      return contentCandidates(label, result)
    }
    if (category === 'fluency' && hasDeduction(result, 'filler_rate')) {
      return result.evidence.flatMap((evidence) => {
        const quote = nonEmptyString(evidence.quote)
        return evidence.source === 'transcript' &&
          quote &&
          evidence.detail === 'Filler detected in the transcript.'
          ? [{ quote, detail: evidence.detail, label }]
          : []
      })
    }
    if (category === 'clarity' && hasDeduction(result, 'recognition_uncertainty')) {
      return result.evidence.flatMap((evidence) => {
        const quote = nonEmptyString(evidence.quote)
        return evidence.source === 'deepgram_word_confidence' && quote
          ? [{ quote, detail: evidence.detail, label }]
          : []
      })
    }
    return []
  })
}

/** A stored deduction observation is the only source for the compact takeaway. */
export function v2EvidenceTakeaway(payload: V2ScorePayload): string | null {
  return (
    deductionEvidence(payload).find((evidence) => evidence.detail.trim().length > 0)?.detail ?? null
  )
}

/** Formats known persisted feedback fields without rendering untrusted JSON. */
export function formatV2Feedback(result: V2PersistedCategoryScore): string[] {
  const lines: string[] = []
  for (const deduction of result.deductions) {
    if (!isRecord(deduction)) continue
    const detail = nonEmptyString(deduction.detail) ?? nonEmptyString(deduction.observation)
    if (detail) lines.push(detail)
    const suggestion = nonEmptyString(deduction.suggestion)
    if (suggestion) lines.push(`Try: ${suggestion}`)
  }
  for (const evidence of result.evidence) {
    const detail = nonEmptyString(evidence.detail)
    if (detail) lines.push(detail)
  }
  return [...new Set(lines)]
}

/**
 * V2 evidence offsets come from multiple providers and units. Match quoted
 * transcript evidence instead, claiming each occurrence once in stored order.
 */
export function v2TranscriptSegments(transcript: string, payload: V2ScorePayload): Segment[] {
  const ranges: Array<{ from: number; to: number; label: string }> = []
  const occupied: Array<{ from: number; to: number }> = []
  for (const evidence of deductionEvidence(payload)) {
    const lowerTranscript = transcript.toLocaleLowerCase()
    const lowerQuote = evidence.quote.toLocaleLowerCase()
    let from = lowerTranscript.indexOf(lowerQuote)
    while (from !== -1) {
      const to = from + evidence.quote.length
      if (!occupied.some((range) => from < range.to && to > range.from)) {
        occupied.push({ from, to })
        ranges.push({ from, to, label: `${evidence.label}: ${evidence.detail}` })
        break
      }
      from = lowerTranscript.indexOf(lowerQuote, from + 1)
    }
  }

  ranges.sort((left, right) => left.from - right.from || left.to - right.to)

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
