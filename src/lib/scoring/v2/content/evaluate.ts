import {
  CONTENT_PROVIDER_UNAVAILABLE_MESSAGE,
  ContentProviderFailure,
  isRetryableContentProviderFailure,
  reportContentProviderFailure,
} from '@/lib/deepseek/provider'
import {
  V2_CONTENT_DETECTOR_VERSION,
  type MechanicallyCountedSpan,
  type TranscriptEvidenceSpan,
  type V2CategoryResult,
  type V2ContentCategory,
  type V2ContentEvaluation,
  type V2ContentEvaluationInput,
  type V2ContentFinding,
  type V2FindingSeverity,
} from '@/lib/scoring/v2/content/contracts'

const STRUCTURE_CHECKS = [
  'answered_prompt',
  'main_point',
  'logical_progression',
  'relevant_support',
  'unnecessary_repetition',
  'topic_drift',
  'completion',
] as const
const VOCABULARY_KINDS = [
  'precise_wording',
  'imprecise_wording',
  'repeated_wording',
  'vague_language',
  'appropriateness',
] as const
const GRAMMAR_KINDS = ['grammatical_error'] as const
const MAX_FINDINGS_PER_CATEGORY = 8

export class V2ContentParseError extends Error {
  constructor(
    readonly code: 'malformed_json' | 'schema_invalid',
    message: string,
  ) {
    super(message)
    this.name = 'V2ContentParseError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Returns undefined when the wire value is neither a nonempty string nor null. */
function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null
  return text(value) ?? undefined
}

function overlaps(left: TranscriptEvidenceSpan, right: TranscriptEvidenceSpan): boolean {
  return left.start < right.end && right.start < left.end
}

function validSpan(span: TranscriptEvidenceSpan, transcript: string): boolean {
  return (
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start &&
    span.end <= transcript.length &&
    (span.confidence === undefined ||
      (typeof span.confidence === 'number' &&
        Number.isFinite(span.confidence) &&
        span.confidence >= 0 &&
        span.confidence <= 1))
  )
}

function validMechanicalSpan(span: MechanicallyCountedSpan, transcript: string): boolean {
  return (
    validSpan(span, transcript) &&
    typeof span.text === 'string' &&
    span.text.trim().length > 0 &&
    (span.category === 'filler' || span.category === 'false_start' || span.category === 'closer')
  )
}

function locateQuote(quote: string, transcript: string): TranscriptEvidenceSpan | null {
  const direct = transcript.indexOf(quote)
  if (direct >= 0) return { start: direct, end: direct + quote.length }
  const lower = transcript.toLowerCase()
  const at = lower.indexOf(quote.toLowerCase())
  return at < 0 ? null : { start: at, end: at + quote.length }
}

function emptyCategory(category: V2ContentCategory, warning: string): V2CategoryResult {
  return {
    category,
    status: 'not_checked',
    component: null,
    findings: [],
    measurements: {},
    warnings: [warning],
  }
}

function notChecked(provider: string | null, warning: string, calls: number): V2ContentEvaluation {
  return {
    version: V2_CONTENT_DETECTOR_VERSION,
    provider,
    status: 'not_checked',
    categories: {
      structure: emptyCategory('structure', warning),
      grammar: emptyCategory('grammar', warning),
      vocabulary: emptyCategory('vocabulary', warning),
    },
    warnings: [warning],
    calls,
  }
}

function severity(value: unknown): V2FindingSeverity | null {
  return value === 'minor' || value === 'clear' ? value : null
}

function deduction(value: V2FindingSeverity): number {
  return value === 'clear' ? 0.25 : 0.1
}

function categoryResult(
  category: V2ContentCategory,
  findings: V2ContentFinding[],
  warnings: string[],
  measurements: Record<string, number | boolean>,
): V2CategoryResult {
  const total = findings.reduce((sum, finding) => sum + finding.deduction, 0)
  return {
    category,
    status: 'checked',
    component: Math.max(0, Math.min(1, 1 - total)),
    findings,
    measurements,
    warnings,
  }
}

function parsePayload(raw: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new V2ContentParseError(
      'malformed_json',
      'The v2 content response was not a JSON object.',
    )
  }
  if (!isRecord(parsed)) {
    throw new V2ContentParseError(
      'schema_invalid',
      'The v2 content response was not a JSON object.',
    )
  }
  if (parsed.version !== V2_CONTENT_DETECTOR_VERSION) {
    throw new V2ContentParseError(
      'schema_invalid',
      'The v2 content response had an unsupported version.',
    )
  }
  return parsed
}

interface ParseContext {
  transcript: string
  mechanicallyCounted: readonly MechanicallyCountedSpan[]
  unreliable: readonly TranscriptEvidenceSpan[]
  claimed: TranscriptEvidenceSpan[]
}

function explicitEvidence(
  value: Record<string, unknown>,
): TranscriptEvidenceSpan | null | undefined {
  if (value.start === undefined && value.end === undefined) return undefined
  return Number.isInteger(value.start) && Number.isInteger(value.end)
    ? { start: value.start as number, end: value.end as number }
    : null
}

function quoteMatchesSpan(
  quote: string,
  span: TranscriptEvidenceSpan,
  transcript: string,
): boolean {
  return (
    transcript
      .slice(span.start, span.end)
      .localeCompare(quote, undefined, { sensitivity: 'accent' }) === 0
  )
}

function acceptableQuote(
  quote: string,
  context: ParseContext,
  warnings: string[],
  label: string,
  explicit: TranscriptEvidenceSpan | null | undefined,
): TranscriptEvidenceSpan | null {
  if (explicit === null) {
    warnings.push(`${label}: explicit transcript coordinates were malformed`)
    return null
  }
  const evidence = explicit ?? locateQuote(quote, context.transcript)
  if (!evidence) {
    warnings.push(`${label}: quote was not in the transcript`)
    return null
  }
  if (
    explicit !== undefined &&
    (!validSpan(evidence, context.transcript) ||
      !quoteMatchesSpan(quote, evidence, context.transcript))
  ) {
    warnings.push(`${label}: explicit transcript coordinates did not match the quote`)
    return null
  }
  if (context.unreliable.some((span) => overlaps(evidence, span))) {
    warnings.push(`${label}: quote overlaps low-confidence transcription`)
    return null
  }
  if (context.mechanicallyCounted.some((span) => overlaps(evidence, span))) {
    warnings.push(`${label}: quote is already counted mechanically`)
    return null
  }
  if (context.claimed.some((span) => overlaps(evidence, span))) {
    warnings.push(`${label}: quote overlaps an earlier v2 finding`)
    return null
  }
  context.claimed.push(evidence)
  return evidence
}

function parseFinding(
  value: unknown,
  category: 'grammar' | 'vocabulary',
  context: ParseContext,
  warnings: string[],
): V2ContentFinding | null {
  if (!isRecord(value)) return null
  const kind = text(value.kind)
  const quote = text(value.quote)
  const findingSeverity = severity(value.severity)
  const observation = text(value.observation)
  const suggestion = nullableText(value.suggestion)
  if (!kind || !quote || !findingSeverity || !observation || suggestion === undefined) {
    warnings.push(`${category}: malformed finding dropped`)
    return null
  }
  if (category === 'grammar' && !GRAMMAR_KINDS.includes(kind as (typeof GRAMMAR_KINDS)[number])) {
    warnings.push('grammar: unknown finding kind dropped')
    return null
  }
  if (
    category === 'vocabulary' &&
    !VOCABULARY_KINDS.includes(kind as (typeof VOCABULARY_KINDS)[number])
  ) {
    warnings.push('vocabulary: unknown finding kind dropped')
    return null
  }
  const evidence = acceptableQuote(quote, context, warnings, category, explicitEvidence(value))
  if (!evidence) return null
  return {
    kind,
    severity: findingSeverity,
    quote,
    observation,
    suggestion,
    evidence: [evidence],
    deduction: deduction(findingSeverity),
  }
}

function parseStructure(value: unknown, context: ParseContext): V2CategoryResult {
  if (!isRecord(value) || !isRecord(value.checks))
    return emptyCategory('structure', 'structure was missing')
  const findings: V2ContentFinding[] = []
  const warnings: string[] = []
  for (const id of STRUCTURE_CHECKS) {
    const check = value.checks[id]
    if (!isRecord(check) || typeof check.passed !== 'boolean') {
      return emptyCategory('structure', `structure.${id} was missing or malformed`)
    }
    if (check.passed) {
      if (
        check.severity !== null ||
        check.quote !== null ||
        (check.start !== undefined && check.start !== null) ||
        (check.end !== undefined && check.end !== null) ||
        check.observation !== null ||
        check.suggestion !== null
      ) {
        return emptyCategory('structure', `structure.${id} had invalid passed fields`)
      }
      continue
    }
    const findingSeverity = severity(check.severity)
    const observation = text(check.observation)
    const quote = nullableText(check.quote)
    const suggestion = nullableText(check.suggestion)
    if (!findingSeverity || !observation || quote === undefined || suggestion === undefined) {
      return emptyCategory('structure', `structure.${id} was missing or malformed`)
    }
    if (
      quote === null &&
      ((check.start !== undefined && check.start !== null) ||
        (check.end !== undefined && check.end !== null))
    ) {
      return emptyCategory('structure', `structure.${id} had coordinates without a quote`)
    }
    const evidence = quote
      ? acceptableQuote(quote, context, warnings, `structure.${id}`, explicitEvidence(check))
      : null
    if (quote && !evidence) continue
    findings.push({
      kind: id,
      severity: findingSeverity,
      quote,
      observation,
      suggestion,
      evidence: evidence ? [evidence] : [],
      deduction: deduction(findingSeverity),
    })
  }
  return categoryResult('structure', findings, warnings, {
    checks_reviewed: STRUCTURE_CHECKS.length,
  })
}

function parseFindings(
  value: unknown,
  category: 'grammar' | 'vocabulary',
  context: ParseContext,
): V2CategoryResult {
  if (!isRecord(value) || !Array.isArray(value.findings)) {
    return emptyCategory(category, `${category} was missing`)
  }
  const warnings: string[] = []
  const capped = value.findings.slice(0, MAX_FINDINGS_PER_CATEGORY)
  if (value.findings.length > MAX_FINDINGS_PER_CATEGORY) {
    warnings.push(`${category}: findings truncated to ${MAX_FINDINGS_PER_CATEGORY}`)
  }
  const findings = capped.flatMap((item) => {
    const finding = parseFinding(item, category, context, warnings)
    return finding ? [finding] : []
  })
  return categoryResult(category, findings, warnings, { findings_reviewed: capped.length })
}

export function parseV2ContentResponse(
  raw: string,
  input: Pick<
    V2ContentEvaluationInput,
    'transcript' | 'mechanicallyCounted' | 'unreliableTranscriptSpans'
  >,
): Omit<V2ContentEvaluation, 'provider' | 'calls'> {
  const payload = parsePayload(raw)
  const context: ParseContext = {
    transcript: input.transcript,
    mechanicallyCounted: (input.mechanicallyCounted ?? []).filter((span) =>
      validMechanicalSpan(span, input.transcript),
    ),
    unreliable: (input.unreliableTranscriptSpans ?? []).filter((span) =>
      validSpan(span, input.transcript),
    ),
    claimed: [],
  }
  const categories = {
    structure: parseStructure(payload.structure, context),
    grammar: parseFindings(payload.grammar, 'grammar', context),
    vocabulary: parseFindings(payload.vocabulary, 'vocabulary', context),
  }
  const checked = Object.values(categories).some((category) => category.status === 'checked')
  if (!checked) {
    throw new V2ContentParseError(
      'schema_invalid',
      'The v2 content response did not contain a usable category.',
    )
  }
  return {
    version: V2_CONTENT_DETECTOR_VERSION,
    status: checked ? 'checked' : 'not_checked',
    categories,
    warnings: Object.values(categories).flatMap((category) => category.warnings),
  }
}

/** Makes at most two calls and retries only explicitly recoverable provider/output failures. */
export async function runV2ContentEvaluation(
  input: V2ContentEvaluationInput,
): Promise<V2ContentEvaluation> {
  if (input.prompt.trim().length === 0 || input.transcript.trim().length === 0) {
    return notChecked(
      input.provider.name,
      'A prompt and transcript are required for the content check.',
      0,
    )
  }
  let calls = 0
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      calls += 1
      const raw = await input.provider.complete({
        version: V2_CONTENT_DETECTOR_VERSION,
        mode: input.mode,
        prompt: input.prompt,
        transcript: input.transcript,
        timeoutMs: input.timeoutMs,
      })
      return { ...parseV2ContentResponse(raw, input), provider: input.provider.name, calls }
    } catch (error) {
      const failure =
        error instanceof V2ContentParseError
          ? reportContentProviderFailure(
              new ContentProviderFailure(error.code, input.provider.name),
              input.provider.name,
            )
          : reportContentProviderFailure(error, input.provider.name)
      if (attempt === 0 && isRetryableContentProviderFailure(failure)) continue
      return notChecked(input.provider.name, CONTENT_PROVIDER_UNAVAILABLE_MESSAGE, calls)
    }
  }
  return notChecked(input.provider.name, CONTENT_PROVIDER_UNAVAILABLE_MESSAGE, calls)
}
