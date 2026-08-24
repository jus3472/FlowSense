import { analyseFillers, type FillerHit } from '@/lib/scoring/fillers'
import { tokensFromText, type Token } from '@/lib/scoring/tokens'

/**
 * What it took to get a rewrite that no longer contains what was counted.
 *
 * `none` means there was no rewrite to enforce. The other three are the rate of
 * under removal: how often the first response was already clean, how often the
 * model had to be asked again, and how often the text had to be cut by hand.
 */
export type TightenOutcome = 'none' | 'clean' | 'retried' | 'stripped'

export type ViolationSource = 'filler' | 'word_choice'

export interface TightenViolation {
  /** Exactly as it survives, so a retry can list it back verbatim. */
  text: string
  source: ViolationSource
  from: number
  to: number
}

export interface TightenEnforcement {
  text: string
  /** What the mechanical pass had to cut, in the order it cut it. */
  removed: string[]
  /** Anything it could not cut safely, which is reported rather than forced. */
  remaining: string[]
}

/** Removing one exposes another, and three passes has always been enough. */
const MAX_STRIP_PASSES = 3

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character)
}

/** Whole word matches only, so "just" never matches inside "adjust". */
function occurrences(haystack: string, needle: string): Array<{ from: number; to: number }> {
  const found: Array<{ from: number; to: number }> = []
  const trimmed = needle.trim()
  if (trimmed.length === 0) return found

  const lowerHay = haystack.toLowerCase()
  const lowerNeedle = trimmed.toLowerCase()

  let at = lowerHay.indexOf(lowerNeedle)
  while (at !== -1) {
    const to = at + trimmed.length
    const before = isWordCharacter(haystack[at - 1])
    const after = isWordCharacter(haystack[to])
    if (!before && !after) found.push({ from: at, to })
    at = lowerHay.indexOf(lowerNeedle, at + 1)
  }
  return found
}

function rangeOf(tokens: readonly Token[], indices: readonly number[]) {
  const involved = indices
    .map((index) => tokens[index])
    .filter((token): token is Token => Boolean(token))
  if (involved.length === 0) return null
  return {
    from: Math.min(...involved.map((token) => token.charStart)),
    to: Math.max(...involved.map((token) => token.charEnd)),
  }
}

/**
 * A clause restart is a whole clause said again more fully. Cutting it is a
 * content edit rather than a deletion, so the model has to do it and the
 * mechanical pass leaves it alone.
 */
function isStrippable(hit: FillerHit): boolean {
  return hit.subtype !== 'clause_restart'
}

/**
 * Everything in a rewrite that was already charged elsewhere.
 *
 * The same detector that counted the original is run over the rewrite, which is
 * what makes this precise: "like" is only a violation where it is a filler, and
 * a word the speaker stumbled on is only a violation while it is still doubled.
 * A surface comparison could not tell either apart.
 */
export function findTightenViolations(
  tightened: string,
  /** Spans the model flagged under Word choice, which it also promised to cut. */
  flaggedSpans: readonly string[] = [],
): TightenViolation[] {
  const tokens = tokensFromText(tightened)
  const { hits } = analyseFillers(tokens, tokens.length)
  const violations: TightenViolation[] = []

  for (const hit of hits) {
    if (!isStrippable(hit)) continue
    const range = rangeOf(tokens, hit.token_indices)
    if (!range) continue
    violations.push({
      text: tightened.slice(range.from, range.to),
      source: 'filler',
      ...range,
    })
  }

  for (const span of flaggedSpans) {
    for (const range of occurrences(tightened, span)) {
      violations.push({
        text: tightened.slice(range.from, range.to),
        source: 'word_choice',
        ...range,
      })
    }
  }

  // Longest first at a shared start, so an overlap keeps the wider cut.
  const ordered = violations.sort((a, b) => a.from - b.from || b.to - a.to)
  const kept: TightenViolation[] = []
  for (const violation of ordered) {
    const previous = kept[kept.length - 1]
    if (previous && violation.from < previous.to) continue
    kept.push(violation)
  }
  return kept
}

/**
 * Deleting words leaves the punctuation around them behind. Each rule below
 * repairs one shape a removal produces: a doubled space, a comma with nothing
 * left to separate, a sentence that lost every word it had.
 */
export function repairAfterRemoval(text: string): string {
  const repaired = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/[,;:]+(\s*[.!?])/g, '$1')
    .replace(/([.!?])(?:\s*[.!?])+/g, '$1')
    .replace(/^[\s,;:.!?]+/, '')
    .replace(/[\s,;:]+$/, '')

  if (repaired.length === 0) return ''

  // A cut at the front of a sentence hands the opening to the next word, and a
  // cut at the end can take the full stop away with it.
  const capitalized = repaired
    .replace(/^\p{Ll}/u, (letter) => letter.toUpperCase())
    .replace(
      /([.!?]\s+)(\p{Ll})/gu,
      (_match, lead: string, letter: string) => lead + letter.toUpperCase(),
    )

  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`
}

interface Range {
  from: number
  to: number
}

/**
 * The full stop belongs to the sentence, not to the filler that happened to be
 * standing in front of it. Cutting "you know." whole runs the next sentence into
 * this one, so the terminator stays and the stranded comma is repaired later.
 */
function keepTerminator(text: string, range: Range): Range {
  let to = range.to
  while (to > range.from && /[.!?]/.test(text[to - 1] ?? '')) to -= 1
  return { ...range, to }
}

/**
 * The comma that held a filler apart from the words around it has nothing left
 * to separate once the filler is gone, so it goes with it: "but, uh, the main
 * one" has to come back as "but the main one" rather than "but, the main one".
 */
function absorbLeadingComma(text: string, range: Range): Range {
  if (!/[,;:]$/.test(text.slice(range.from, range.to))) return range
  let at = range.from
  while (at > 0 && /\s/.test(text[at - 1] ?? '')) at -= 1
  if (at === 0 || !/[,;:]/.test(text[at - 1] ?? '')) return range
  return { ...range, from: at - 1 }
}

/** Cuts the given ranges out of the text, back to front so the offsets hold. */
export function cutRanges(text: string, ranges: readonly Range[]): string {
  const widened = ranges
    .map((range) => absorbLeadingComma(text, keepTerminator(text, range)))
    .sort((a, b) => a.from - b.from)

  // Two cuts can reach for the same comma, and cutting it twice takes a
  // neighbouring space with it.
  const merged: Range[] = []
  for (const range of widened) {
    const previous = merged[merged.length - 1]
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else merged.push({ ...range })
  }

  let out = text
  for (const range of merged.reverse()) {
    out = out.slice(0, range.from) + out.slice(range.to)
  }
  return repairAfterRemoval(out)
}

/**
 * The last resort. Only reached when the model was asked twice and still handed
 * back its own padding, so the text is cut here instead. One removal can expose
 * another, which is why it runs until the text stops changing.
 */
export function stripViolations(
  tightened: string,
  flaggedSpans: readonly string[] = [],
): TightenEnforcement {
  let text = tightened
  const removed: string[] = []

  for (let pass = 0; pass < MAX_STRIP_PASSES; pass += 1) {
    const violations = findTightenViolations(text, flaggedSpans)
    if (violations.length === 0) break
    for (const violation of violations) removed.push(violation.text)
    text = cutRanges(text, violations)
  }

  return {
    text,
    removed,
    remaining: findTightenViolations(text, flaggedSpans).map((violation) => violation.text),
  }
}

/**
 * The exact strings the rewrite must not contain, for the prompt to list.
 *
 * False starts are left out on purpose. Their surface is an ordinary word that
 * has to survive once, and "delete every I" is not an instruction any rewrite
 * can follow. The prompt asks for those in words instead.
 */
export function surfacesToDelete(countedItems: readonly FillerHit[]): string[] {
  const seen = new Set<string>()
  const surfaces: string[] = []

  for (const item of countedItems) {
    if (item.category === 'false_start') continue
    const key = item.text
      .toLowerCase()
      .replace(/[^a-z0-9' ]/g, '')
      .trim()
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    surfaces.push(item.text.trim())
  }

  return surfaces
}
