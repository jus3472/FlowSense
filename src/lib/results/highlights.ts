import type { CheckFinding, CheckName, ExtraSpan } from '@/lib/scoring/content'
import type { FillerHit } from '@/lib/scoring/fillers'
import type { Pause } from '@/lib/scoring/pauses'
import type { RepeatedPhrase } from '@/lib/scoring/statistics'
import { buildTokens, type Token } from '@/lib/scoring/tokens'
import type { TranscriptWord } from '@/lib/deepgram/parse'

/** Only pauses this long cost points, so only these are marked. */
export const CHARGED_PAUSE_MS = 1000
/** Time to first word is free up to here, so nothing is marked below it. */
export const FREE_FIRST_WORD_MS = 2500

export type HighlightKind = 'filler' | 'false_start' | 'word_choice' | 'repetition' | 'explained'

export interface Highlight {
  from: number
  to: number
  kind: HighlightKind
  /** Names the check and the reason, shown on hover. */
  label: string
}

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'highlight'; text: string; kind: HighlightKind; label: string }
  | { type: 'marker'; text: string; label: string }

export interface HighlightInput {
  transcript: string
  words: readonly TranscriptWord[]
  countedItems: readonly FillerHit[]
  pauses: readonly Pause[]
  extraSpans: readonly ExtraSpan[]
  checks: Record<CheckName, CheckFinding>
  repeatedPhrases: readonly RepeatedPhrase[]
  timeToFirstWordMs: number
}

function findAll(haystack: string, needle: string): Array<{ from: number; to: number }> {
  const found: Array<{ from: number; to: number }> = []
  if (needle.trim().length === 0) return found

  const lowerHay = haystack.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  let at = lowerHay.indexOf(lowerNeedle)
  while (at !== -1) {
    found.push({ from: at, to: at + needle.length })
    at = lowerHay.indexOf(lowerNeedle, at + needle.length)
  }
  return found
}

function rangeFor(tokens: readonly Token[], indices: readonly number[]) {
  const involved = indices
    .map((index) => tokens[index])
    .filter((token): token is Token => Boolean(token))
  if (involved.length === 0) return null
  return {
    from: Math.min(...involved.map((token) => token.charStart)),
    to: Math.max(...involved.map((token) => token.charEnd)),
  }
}

const FILLER_LABEL: Record<string, string> = {
  word_restart: 'False start',
  clause_restart: 'False start, restarted clause',
}

/**
 * Every span that cost points, and nothing else.
 *
 * Answered the question and Logical order are verdicts on the whole response,
 * so they are deliberately absent: a highlight has to point at the words that
 * were charged for, or the amber stops meaning anything.
 */
export function collectHighlights(input: HighlightInput): Highlight[] {
  const tokens = buildTokens(input.words, input.transcript)
  const highlights: Highlight[] = []

  for (const item of input.countedItems) {
    const kind: HighlightKind = item.category === 'false_start' ? 'false_start' : 'filler'
    const label =
      item.category === 'false_start'
        ? (FILLER_LABEL[item.subtype] ?? 'False start')
        : item.category === 'closer'
          ? 'Filler, closing hedge'
          : 'Filler'

    const range = rangeFor(tokens, item.token_indices)
    if (range) highlights.push({ ...range, kind, label })
  }

  for (const span of input.extraSpans) {
    for (const range of findAll(input.transcript, span.text)) {
      highlights.push({ ...range, kind: 'word_choice', label: `Word choice, ${span.category}` })
    }
  }

  const wordChoice = input.checks.word_choice
  if (!wordChoice.passed && wordChoice.quote) {
    for (const range of findAll(input.transcript, wordChoice.quote)) {
      highlights.push({ ...range, kind: 'word_choice', label: 'Word choice' })
    }
  }

  // Anchored to the phrases the mechanical half found, so every occurrence marks.
  if (!input.checks.no_repetition.passed) {
    const quoted = input.checks.no_repetition.quote
    const phrases = quoted ? [quoted] : input.repeatedPhrases.map((phrase) => phrase.phrase)
    for (const phrase of phrases) {
      for (const range of findAll(input.transcript, phrase)) {
        highlights.push({ ...range, kind: 'repetition', label: 'No repetition' })
      }
    }
  }

  const explained = input.checks.explained
  if (!explained.passed && explained.quote) {
    for (const range of findAll(input.transcript, explained.quote)) {
      highlights.push({ ...range, kind: 'explained', label: 'Explained your reasoning' })
    }
  }

  return highlights.sort((a, b) => a.from - b.from || b.to - a.to)
}

/**
 * Merges touching runs of the same label into one continuous highlight, so a
 * flagged span reads as one mark rather than a row of separate boxes. An
 * earlier highlight always wins an overlap.
 */
export function mergeHighlights(highlights: readonly Highlight[], transcript: string): Highlight[] {
  const merged: Highlight[] = []

  for (const highlight of highlights) {
    const previous = merged[merged.length - 1]
    if (!previous) {
      merged.push({ ...highlight })
      continue
    }

    if (highlight.from < previous.to) {
      previous.to = Math.max(previous.to, highlight.to)
      continue
    }

    const between = transcript.slice(previous.to, highlight.from)
    if (previous.label === highlight.label && between.trim().length === 0) {
      previous.to = highlight.to
      continue
    }

    merged.push({ ...highlight })
  }

  return merged
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * The transcript as a flat list of runs, with pause markers inserted inline.
 * No check name ever reaches the text itself: labels live on the popover.
 */
export function buildSegments(input: HighlightInput): Segment[] {
  const tokens = buildTokens(input.words, input.transcript)
  const merged = mergeHighlights(collectHighlights(input), input.transcript)

  const markers: Array<{ at: number; text: string; label: string }> = []
  for (const pause of input.pauses) {
    if (pause.kind !== 'mid_sentence' || pause.duration_ms < CHARGED_PAUSE_MS) continue
    const before = tokens.filter((token) => token.end * 1000 <= pause.start_ms + 50).at(-1)
    markers.push({
      at: before ? before.charEnd : 0,
      text: `·${formatSeconds(pause.duration_ms)}·`,
      label: `Mid-sentence pause, ${formatSeconds(pause.duration_ms)}`,
    })
  }

  if (input.timeToFirstWordMs > FREE_FIRST_WORD_MS) {
    markers.push({
      at: 0,
      text: `·${formatSeconds(input.timeToFirstWordMs)}·`,
      label: `Time to first word, ${formatSeconds(input.timeToFirstWordMs)} before you started`,
    })
  }
  markers.sort((a, b) => a.at - b.at)

  const segments: Segment[] = []
  const push = (text: string) => {
    if (text.length > 0) segments.push({ type: 'text', text })
  }

  let cursor = 0
  const emitMarkersUpTo = (limit: number) => {
    while (markers.length > 0 && markers[0]!.at <= limit) {
      const marker = markers.shift()!
      const at = Math.max(cursor, marker.at)
      push(input.transcript.slice(cursor, at))
      cursor = at
      segments.push({ type: 'marker', text: marker.text, label: marker.label })
    }
  }

  for (const highlight of merged) {
    emitMarkersUpTo(highlight.from)
    push(input.transcript.slice(cursor, highlight.from))
    segments.push({
      type: 'highlight',
      text: input.transcript.slice(highlight.from, highlight.to),
      kind: highlight.kind,
      label: highlight.label,
    })
    cursor = highlight.to
  }

  emitMarkersUpTo(input.transcript.length)
  push(input.transcript.slice(cursor))

  return segments
}
