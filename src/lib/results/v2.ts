import type { Segment } from '@/lib/results/highlights'
import type { PracticeMode, SkillCategory } from '@/lib/practice/contracts'
import type { V2PersistedCategoryScore, V2ScorePayload } from '@/lib/scoring/v2/assemble'
import {
  exactOrLegacyTranscriptRange,
  exactTranscriptRange,
  validTranscriptCharacterRange,
} from '@/lib/scoring/v2/evidence'

interface TranscriptCandidate {
  quote: string
  label: string
  detail: string
  from: number
  to: number
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

export interface V2CategoryStatusView {
  label: string
  description: string | null
}

type ScoredV2CategoryView = V2CategoryView & {
  result: V2PersistedCategoryScore & { status: 'scored'; component: number }
}

export function v2CategoryViews(payload: V2ScorePayload): V2CategoryView[] {
  return V2_CATEGORY_ORDER.map((category) => ({
    category,
    label: V2_CATEGORY_LABELS[category],
    result: payload.categories[category],
  }))
}

/** Maps every persisted category state to literal, non-scored presentation copy. */
export function v2CategoryStatusView(result: V2PersistedCategoryScore): V2CategoryStatusView {
  switch (result.status) {
    case 'scored':
      return {
        label: `${result.earned_points} / ${result.max_points}`,
        description: null,
      }
    case 'not_checked':
      return {
        label: 'Not checked',
        description: 'This check was available, but it did not return a result.',
      }
    case 'unavailable':
      return {
        label: 'Unavailable',
        description: 'The evidence needed for this category was unavailable.',
      }
  }
}

function scoredCategories(payload: V2ScorePayload): ScoredV2CategoryView[] {
  return v2CategoryViews(payload).filter(
    (view): view is ScoredV2CategoryView =>
      view.result.status === 'scored' && view.result.component !== null,
  )
}

export function strongestV2Category(payload: V2ScorePayload): V2CategoryView | null {
  const candidates = scoredCategories(payload)
  if (candidates.length === 0) return null
  const strongestComponent = Math.max(...candidates.map(({ result }) => result.component))
  const strongest = candidates.filter(({ result }) => result.component === strongestComponent)
  return strongest.length === 1 ? (strongest[0] ?? null) : null
}

export function priorityV2Category(payload: V2ScorePayload): V2CategoryView | null {
  const candidates = scoredCategories(payload).filter(({ result }) => result.component < 1)
  if (candidates.length === 0) return null
  const priorityComponent = Math.min(...candidates.map(({ result }) => result.component))
  const priority = candidates.filter(({ result }) => result.component === priorityComponent)
  return priority.length === 1 ? (priority[0] ?? null) : null
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
        (typeof entry[1] === 'number' && Number.isFinite(entry[1])) ||
        typeof entry[1] === 'boolean',
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

function contentCandidates(
  transcript: string,
  label: string,
  result: V2PersistedCategoryScore,
): TranscriptCandidate[] {
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
    const range =
      quote && detail
        ? (result.evidence.flatMap((evidence) => {
            if (evidence.detail !== detail || nonEmptyString(evidence.quote) !== quote) return []
            const validated = exactTranscriptRange(transcript, evidence)
            return validated ? [validated] : []
          })[0] ??
          (Array.isArray(deduction.evidence)
            ? deduction.evidence.flatMap((evidence) => {
                if (!isRecord(evidence)) return []
                const validated = validTranscriptCharacterRange(
                  transcript,
                  evidence.start,
                  evidence.end,
                  quote,
                )
                return validated ? [validated] : []
              })[0]
            : null))
        : null
    return quote && detail && range ? [{ quote, detail, label, ...range }] : []
  })
}

function exactEvidenceCandidate(
  transcript: string,
  label: string,
  evidence: V2PersistedCategoryScore['evidence'][number],
): TranscriptCandidate[] {
  const quote = nonEmptyString(evidence.quote)
  const range = exactOrLegacyTranscriptRange(transcript, evidence)
  return quote && range ? [{ quote, detail: evidence.detail, label, ...range }] : []
}

function deductionEvidence(transcript: string, payload: V2ScorePayload): TranscriptCandidate[] {
  return v2CategoryViews(payload).flatMap(({ category, label, result }) => {
    if (result.status !== 'scored') return []
    if (category === 'grammar' || category === 'vocabulary' || category === 'structure') {
      return contentCandidates(transcript, label, result)
    }
    if (category === 'fluency' && hasDeduction(result, 'filler_rate')) {
      return result.evidence.flatMap((evidence) => {
        return evidence.source === 'transcript' &&
          evidence.detail === 'Filler detected in the transcript.'
          ? exactEvidenceCandidate(transcript, label, evidence)
          : []
      })
    }
    if (category === 'clarity' && hasDeduction(result, 'recognition_uncertainty')) {
      return result.evidence.flatMap((evidence) => {
        return evidence.source === 'deepgram_word_confidence'
          ? exactEvidenceCandidate(transcript, label, evidence)
          : []
      })
    }
    return []
  })
}

function storedDeductionDetail(result: V2PersistedCategoryScore): string | null {
  for (const deduction of result.deductions) {
    if (!isRecord(deduction)) continue
    const detail = nonEmptyString(deduction.detail) ?? nonEmptyString(deduction.observation)
    if (detail) return detail
  }
  return null
}

/**
 * A compact, deterministic explanation for every v2 snapshot. It stays
 * factual and derives only from persisted deductions and category results.
 */
export function v2OverallTakeaway(payload: V2ScorePayload): string {
  const priority = priorityV2Category(payload)
  if (priority) {
    const deduction = storedDeductionDetail(priority.result)
    if (deduction) return deduction
    if (priority.result.earned_points !== null) {
      return `${priority.label} has ${priority.result.earned_points} of ${priority.result.max_points} points in this response.`
    }
  }
  if (payload.total_earned_points === null) {
    const statuses = v2CategoryViews(payload).map(({ result }) => result.status)
    const hasNotChecked = statuses.includes('not_checked')
    const hasUnavailable = statuses.includes('unavailable')

    if (hasNotChecked && hasUnavailable) {
      return 'Some categories were not checked, and some lacked required evidence, so the overall result is unavailable.'
    }
    if (hasUnavailable) {
      return 'Required evidence was unavailable for some categories, so the overall result is unavailable.'
    }
    if (hasNotChecked) {
      return 'Some categories were not checked, so the overall result is unavailable.'
    }
    return 'The overall result is unavailable.'
  }
  if (payload.total_earned_points < payload.total_max_points) {
    return `This response has ${payload.total_earned_points} of ${payload.total_max_points} points.`
  }
  return 'No category lost points in this response.'
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
 * Only explicitly validated transcript-character evidence is highlighted.
 * Historical time offsets and quote-only findings are never re-located to a
 * later repeated phrase, because doing so would invent evidence coordinates.
 */
export function v2TranscriptSegments(transcript: string, payload: V2ScorePayload): Segment[] {
  const ranges: Array<{ from: number; to: number; label: string }> = []
  const occupied: Array<{ from: number; to: number }> = []
  for (const evidence of deductionEvidence(transcript, payload)) {
    if (occupied.some((range) => evidence.from < range.to && evidence.to > range.from)) continue
    occupied.push({ from: evidence.from, to: evidence.to })
    ranges.push({
      from: evidence.from,
      to: evidence.to,
      label: `${evidence.label}: ${evidence.detail}`,
    })
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
