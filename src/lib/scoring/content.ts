import type { TightenOutcome } from '@/lib/scoring/tighten'

export const CONTENT_POINTS = {
  answered: 14,
  explained: 12,
  word_choice: 12,
  logical_order: 7,
  no_repetition: 5,
} as const

export type CheckName = keyof typeof CONTENT_POINTS
export type Severity = 'minor' | 'clear'
export type SpanCategory = 'padding' | 'preamble' | 'qualifier' | 'hedge' | 'imprecise'

export const CHECK_NAMES: readonly CheckName[] = [
  'answered',
  'explained',
  'word_choice',
  'logical_order',
  'no_repetition',
]

const SPAN_CATEGORIES: readonly SpanCategory[] = [
  'padding',
  'preamble',
  'qualifier',
  'hedge',
  'imprecise',
]

const MAX_SPANS = 8
/**
 * Measured against the expected tightened length, not the original. A response
 * with eight flagged spans should come back roughly a quarter shorter, and
 * comparing to the original discarded the rewrite on exactly the messiest
 * responses, which are the ones it helps most.
 */
const TIGHTENED_MIN = 0.85
const TIGHTENED_MAX = 1.25

/** Word choice is graded by how many spans were flagged, not by severity. */
const WORD_CHOICE_POINTS = [12, 9, 7, 5, 3, 0]

export interface CheckFinding {
  passed: boolean
  severity: Severity | null
  quote: string | null
  observation: string | null
  suggestion: string | null
}

export interface ExtraSpan {
  text: string
  category: SpanCategory
}

export interface ParsedContent {
  checks: Record<CheckName, CheckFinding>
  extra_spans: ExtraSpan[]
  tightened: string | null
  /** What validation removed, and why. Kept so a bad response is debuggable. */
  dropped: string[]
  /** What it took to get a rewrite with none of the counted padding left in it. */
  tightened_outcome: TightenOutcome
}

export class ContentParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentParseError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const passing = (): CheckFinding => ({
  passed: true,
  severity: null,
  quote: null,
  observation: null,
  suggestion: null,
})

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
}

/** Strips punctuation too, so "um," and "um" compare equal. */
export function normalizeSpan(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9' ]/g, '')
    .trim()
}

/**
 * One flagged span, however it was punctuated or capitalized when it was
 * reported. The same span can arrive as a quoted finding and again in the span
 * list, and it is one span either way: it is shown once and charged once.
 */
export function sameSpan(a: string, b: string): boolean {
  const left = normalizeSpan(a)
  return left.length > 0 && left === normalizeSpan(b)
}

/**
 * Nothing may cost points twice. The mechanical detector already charged every
 * filler, false start, and closing hedge under Filler words, so a span covering
 * the same words cannot also cost Word choice points. The system prompt asks the
 * model to leave them alone and it mostly does, but a real response came back
 * with six of them, so the rule is enforced here rather than trusted.
 */
function alreadyCharged(text: string, counted: readonly string[]): boolean {
  const span = normalizeSpan(text)
  if (span.length === 0) return true
  return counted.some((item) => {
    const other = normalizeSpan(item)
    return other.length > 0 && (other === span || other.includes(span) || span.includes(other))
  })
}

/** Quotes must be the speaker's own words, so anything else is discarded. */
export function isExactQuote(quote: string, transcript: string): boolean {
  if (quote.trim().length === 0) return false
  if (transcript.includes(quote)) return true
  return normalize(transcript).includes(normalize(quote))
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Validates the model's output before any of it reaches a score. Every
 * unusable part is dropped in the direction that costs the user nothing.
 */
export function parseContentResponse(
  raw: string,
  transcript: string,
  /** Text already charged mechanically, which may not be charged again. */
  alreadyCountedText: readonly string[] = [],
  /** Token count charged mechanically, which the rewrite is expected to drop. */
  alreadyCountedTokens = 0,
): ParsedContent {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    // Models sometimes wrap JSON in prose or a code fence.
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) throw new ContentParseError('The response was not JSON.')
    try {
      payload = JSON.parse(raw.slice(start, end + 1))
    } catch {
      throw new ContentParseError('The response was not JSON.')
    }
  }

  if (!isRecord(payload)) throw new ContentParseError('The response was not a JSON object.')
  const rawChecks = payload.checks
  if (!isRecord(rawChecks)) throw new ContentParseError('The response had no checks.')

  const dropped: string[] = []
  const checks = {} as Record<CheckName, CheckFinding>

  for (const name of CHECK_NAMES) {
    const entry = rawChecks[name]
    if (!isRecord(entry)) {
      checks[name] = passing()
      dropped.push(`${name}: missing, treated as passed`)
      continue
    }

    if (entry.passed !== false) {
      checks[name] = passing()
      continue
    }

    const quote = readString(entry.quote)
    if (name === 'word_choice' && quote && alreadyCharged(quote, alreadyCountedText)) {
      checks[name] = passing()
      dropped.push(`${name}: "${quote}" is already counted under filler words`)
      continue
    }
    if (quote && !isExactQuote(quote, transcript)) {
      // A finding that misquotes the speaker cannot be shown, so it cannot cost points.
      checks[name] = passing()
      dropped.push(`${name}: quote was not in the transcript, treated as passed`)
      continue
    }

    const severity = entry.severity === 'clear' ? 'clear' : 'minor'
    checks[name] = {
      passed: false,
      severity,
      quote,
      observation: readString(entry.observation),
      suggestion: readString(entry.suggestion),
    }
  }

  const spans: ExtraSpan[] = []
  if (Array.isArray(payload.extra_spans)) {
    for (const entry of payload.extra_spans) {
      if (spans.length >= MAX_SPANS) {
        dropped.push('extra_spans: truncated to 8')
        break
      }
      if (!isRecord(entry)) continue
      const text = readString(entry.text)
      if (!text) continue
      if (!isExactQuote(text, transcript)) {
        dropped.push(`extra_spans: "${text}" was not in the transcript`)
        continue
      }
      if (alreadyCharged(text, alreadyCountedText)) {
        dropped.push(`extra_spans: "${text}" is already counted under filler words`)
        continue
      }
      const category = SPAN_CATEGORIES.includes(entry.category as SpanCategory)
        ? (entry.category as SpanCategory)
        : 'padding'
      spans.push({ text, category })
    }
  }

  const flaggedWords =
    alreadyCountedTokens +
    spans.reduce((sum, span) => sum + countWords(span.text), 0) +
    (checks.word_choice.passed ? 0 : countWords(checks.word_choice.quote ?? ''))
  const expected = expectedTightenedWords(transcript, flaggedWords)

  let tightened = readString(payload.tightened)
  if (tightened && !tightenedFitsBand(tightened, expected)) {
    dropped.push(
      `tightened: ${countWords(tightened)} words against an expected ${expected} ` +
        `(${countWords(transcript)} spoken minus ${flaggedWords} flagged) is outside the ` +
        `85 to 125 percent band`,
    )
    tightened = null
  }

  return {
    checks,
    extra_spans: spans,
    tightened,
    dropped,
    // The rewrite has not been enforced yet, only measured.
    tightened_outcome: tightened ? 'clean' : 'none',
  }
}

/** The spoken length minus everything that was flagged, floored at one word. */
export function expectedTightenedWords(transcript: string, flaggedWords: number): number {
  return Math.max(1, countWords(transcript) - flaggedWords)
}

/** A tightening, not a summary and not an expansion. */
export function tightenedFitsBand(tightened: string, expected: number): boolean {
  const ratio = countWords(tightened) / expected
  return ratio >= TIGHTENED_MIN && ratio <= TIGHTENED_MAX
}

/**
 * The focused second ask returns only the rewrite. Anything unusable comes back
 * as null, which sends the caller on to the mechanical strip.
 */
export function parseRewriteResponse(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const payload: unknown = JSON.parse(raw.slice(start, end + 1))
    return isRecord(payload) ? readString(payload.tightened) : null
  } catch {
    return null
  }
}

export interface Dispute {
  /** A check name, or "word_choice_span" for one flagged span. */
  note_type: string
  quote: string | null
}

/** A disputed finding stops deducting. There is no limit on how many may be disputed. */
export function applyDisputes(parsed: ParsedContent, disputes: readonly Dispute[]): ParsedContent {
  if (disputes.length === 0) return parsed

  const checks = { ...parsed.checks }
  for (const name of CHECK_NAMES) {
    const disputed = disputes.some(
      (dispute) =>
        dispute.note_type === name &&
        (dispute.quote === null || dispute.quote === checks[name].quote),
    )
    if (disputed) checks[name] = passing()
  }

  const spanDisputes = disputes.filter((dispute) => dispute.note_type === 'word_choice_span')
  // A span quoted by the Word choice finding is shown once and disputed once, so
  // keeping the finding has to release the span it was quoting as well.
  const keptQuotes = disputes
    .filter((dispute) => dispute.note_type === 'word_choice' && dispute.quote !== null)
    .map((dispute) => dispute.quote as string)

  const spans = parsed.extra_spans.filter(
    (span) =>
      !spanDisputes.some((dispute) => dispute.quote === null || dispute.quote === span.text) &&
      !keptQuotes.some((quote) => sameSpan(span.text, quote)),
  )

  return { ...parsed, checks, extra_spans: spans }
}

export function wordChoicePoints(spanCount: number): number {
  const index = Math.min(spanCount, WORD_CHOICE_POINTS.length - 1)
  return WORD_CHOICE_POINTS[index] ?? 0
}

/** minor earns 40 percent of the check, clear earns nothing, a pass earns all of it. */
export function severityPoints(maxPoints: number, finding: CheckFinding): number {
  if (finding.passed) return maxPoints
  if (finding.severity === 'clear') return 0
  return Math.round(maxPoints * 0.4)
}

export interface ContentScore {
  points: Record<CheckName, number>
  total: number
}

export function scoreContent(parsed: ParsedContent): ContentScore {
  // Every span the model flagged, however it was reported. Normalized, because a
  // span quoted in the finding and repeated in the list is one span.
  const flagged = new Set(parsed.extra_spans.map((span) => normalizeSpan(span.text)))
  const wordChoice = parsed.checks.word_choice
  if (!wordChoice.passed && wordChoice.quote) flagged.add(normalizeSpan(wordChoice.quote))

  const points = {
    answered: severityPoints(CONTENT_POINTS.answered, parsed.checks.answered),
    explained: severityPoints(CONTENT_POINTS.explained, parsed.checks.explained),
    word_choice: wordChoicePoints(flagged.size),
    logical_order: severityPoints(CONTENT_POINTS.logical_order, parsed.checks.logical_order),
    no_repetition: severityPoints(CONTENT_POINTS.no_repetition, parsed.checks.no_repetition),
  }

  return { points, total: Object.values(points).reduce((sum, value) => sum + value, 0) }
}

/** An outage must never cost a user points. */
export function notCheckedContent(): ParsedContent {
  const checks = {} as Record<CheckName, CheckFinding>
  for (const name of CHECK_NAMES) checks[name] = passing()
  return { checks, extra_spans: [], tightened: null, dropped: [], tightened_outcome: 'none' }
}
