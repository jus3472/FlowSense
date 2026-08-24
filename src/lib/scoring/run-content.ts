import type { ContentModel, ContentModelRequest } from '@/lib/deepseek/provider'
import {
  ContentParseError,
  countWords,
  expectedTightenedWords,
  parseContentResponse,
  parseRewriteResponse,
  tightenedFitsBand,
  type ParsedContent,
} from '@/lib/scoring/content'
import { findTightenViolations, stripViolations, type TightenOutcome } from '@/lib/scoring/tighten'

export interface RewriteRetryRequest {
  previous: string
  mustNotAppear: readonly string[]
  targetWords: number
}

export interface TightenReport {
  outcome: TightenOutcome
  /** What the first response left in, so the rate of under removal is visible. */
  violations: string[]
  /** What the mechanical pass had to cut, when it came to that. */
  removed: string[]
  /** Anything even that could not cut safely. */
  remaining: string[]
}

export interface TightenInput {
  model: ContentModel
  transcript: string
  /** How many tokens the mechanical half counted, for the rewrite length band. */
  countedTokens?: number
  /** Builds the focused second ask. Without one, a bad rewrite goes straight to the strip. */
  rewriteRequest?: (input: RewriteRetryRequest) => ContentModelRequest
}

export interface ContentCheckInput extends TightenInput {
  request: ContentModelRequest
  /** Text already charged mechanically, which may not be charged again. */
  countedText?: readonly string[]
}

export interface ContentCheckOutcome {
  parsed: ParsedContent | null
  error: string | null
  calls: number
  tighten: TightenReport | null
}

/** Every span the model flagged, which the rewrite also promised to remove. */
function flaggedSpans(parsed: ParsedContent): string[] {
  const spans = parsed.extra_spans.map((span) => span.text)
  const wordChoice = parsed.checks.word_choice
  if (!wordChoice.passed && wordChoice.quote) spans.push(wordChoice.quote)
  return spans
}

/**
 * The rewrite is the one part of the response that is checked against the rest
 * of the score rather than against itself. A prompt instruction to drop the
 * counted fillers was followed loosely, so this asks again with the offending
 * strings named, and cuts them by hand if the second answer is no better.
 */
export async function enforceTightened(
  parsed: ParsedContent,
  input: TightenInput,
): Promise<{ parsed: ParsedContent; report: TightenReport; calls: number }> {
  const spans = flaggedSpans(parsed)

  if (!parsed.tightened) {
    return {
      parsed,
      report: { outcome: 'none', violations: [], removed: [], remaining: [] },
      calls: 0,
    }
  }

  const violations = findTightenViolations(parsed.tightened, spans)
  if (violations.length === 0) {
    return {
      parsed: { ...parsed, tightened_outcome: 'clean' },
      report: { outcome: 'clean', violations: [], removed: [], remaining: [] },
      calls: 0,
    }
  }

  const offending = [...new Set(violations.map((violation) => violation.text))]
  // The same band the first response was measured against, so a retry is not
  // held to a different length.
  const flaggedWords =
    (input.countedTokens ?? 0) + spans.reduce((sum, span) => sum + countWords(span), 0)
  const expected = expectedTightenedWords(input.transcript, flaggedWords)
  let calls = 0

  if (input.rewriteRequest) {
    try {
      calls += 1
      const raw = await input.model.complete(
        input.rewriteRequest({
          previous: parsed.tightened,
          mustNotAppear: offending,
          targetWords: expected,
        }),
      )
      const retried = parseRewriteResponse(raw)
      if (
        retried &&
        tightenedFitsBand(retried, expected) &&
        findTightenViolations(retried, spans).length === 0
      ) {
        return {
          parsed: { ...parsed, tightened: retried, tightened_outcome: 'retried' },
          report: { outcome: 'retried', violations: offending, removed: [], remaining: [] },
          calls,
        }
      }
    } catch {
      // A failed second ask is not a scored failure. The strip below still runs.
    }
  }

  const stripped = stripViolations(parsed.tightened, spans)
  return {
    parsed: { ...parsed, tightened: stripped.text, tightened_outcome: 'stripped' },
    report: {
      outcome: 'stripped',
      violations: offending,
      removed: stripped.removed,
      remaining: stripped.remaining,
    },
    calls,
  }
}

/**
 * One retry, and only for malformed JSON, because that is the failure a second
 * attempt actually fixes. A timeout or a rejected request will not improve by
 * asking again, so it fails straight through to the not_checked path where the
 * user keeps every content point.
 */
export async function runContentCheck(input: ContentCheckInput): Promise<ContentCheckOutcome> {
  let parsed: ParsedContent | null = null
  let error: string | null = null
  let calls = 0

  for (let attempt = 0; attempt < 2 && parsed === null; attempt += 1) {
    try {
      calls += 1
      const raw = await input.model.complete(input.request)
      parsed = parseContentResponse(
        raw,
        input.transcript,
        input.countedText ?? [],
        input.countedTokens ?? 0,
      )
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : 'The content check failed.'
      if (!(thrown instanceof ContentParseError)) break
    }
  }

  if (parsed === null) return { parsed: null, error, calls, tighten: null }

  const enforced = await enforceTightened(parsed, input)
  return {
    parsed: enforced.parsed,
    error: null,
    calls: calls + enforced.calls,
    tighten: enforced.report,
  }
}
