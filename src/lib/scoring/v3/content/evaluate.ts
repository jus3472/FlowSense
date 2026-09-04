import {
  ContentProviderFailure,
  isRetryableContentProviderFailure,
  reportContentProviderFailure,
} from '@/lib/deepseek/provider'
import {
  V3_CONTENT_EVALUATOR_VERSION,
  type MechanicalConcisenessKind,
  type V3ContentEvaluation,
  type V3ContentFailureDiagnostic,
  type V3ContentEvaluationInput,
  type V3ContentMetricResult,
  type V3MechanicallyOwnedSpan,
  type V3TranscriptSpan,
} from '@/lib/scoring/v3/content/contracts'
import {
  WHAT_YOU_SAID_METRICS,
  inUnitInterval,
  type V3MetricDetail,
  type V3ScoreEvidence,
  type WhatYouSaidMetricId,
} from '@/lib/scoring/v3/contracts'

const FINDING_KINDS: Readonly<Record<WhatYouSaidMetricId, readonly string[]>> = Object.freeze({
  answered_prompt: Object.freeze(['no_prompt_answer', 'incomplete_prompt_coverage']),
  specificity: Object.freeze([
    'unsupported_claim',
    'missing_detail',
    'missing_reason',
    'missing_outcome',
  ]),
  structure: Object.freeze([
    'unclear_order',
    'scattered_ideas',
    'misplaced_information',
    'incomplete_arc',
  ]),
  conciseness: Object.freeze([
    'filler',
    'repeated_idea',
    'redundant_sentence',
    'irrelevant_content',
    'unnecessary_tangent',
    'unnecessary_qualifier',
  ]),
  word_choice: Object.freeze(['vague_wording', 'imprecise_wording', 'inappropriate_wording']),
  grammar: Object.freeze(['grammatical_error']),
})

const NULL_EVIDENCE_METRICS = new Set<WhatYouSaidMetricId>([
  'answered_prompt',
  'specificity',
  'structure',
])
const CLAIM_PRECEDENCE = [
  'answered_prompt',
  'specificity',
  'structure',
  'conciseness',
  'grammar',
  'word_choice',
] as const satisfies readonly WhatYouSaidMetricId[]
const MAX_FINDINGS_PER_METRIC = 8
const MAX_SUPPORTING_SPANS = 4
const MAX_EXPLANATION_LENGTH = 500
const MAX_DETAIL_LENGTH = 500

export const V3_CONTENT_CHECK_UNAVAILABLE_MESSAGE = 'The content check could not be completed.'
export const V3_CONTENT_CHECK_INVALID_MESSAGE = 'Some content checks could not be completed.'

export const STRUCTURAL_CONCISENESS_REDUCTION: Readonly<Record<MechanicalConcisenessKind, number>> =
  Object.freeze({ false_start: 0.06 })
export const MAX_STRUCTURAL_CONCISENESS_REDUCTION = 0.5

export class V3ContentParseError extends Error {
  constructor(
    readonly code: 'malformed_json' | 'schema_invalid',
    message: string,
    readonly reason: string = code,
    readonly metric: WhatYouSaidMetricId | null = null,
  ) {
    super(message)
    this.name = 'V3ContentParseError'
  }
}

const CONTENT_VALIDATION_REASONS = new Set([
  'whole_response_evidence_invalid',
  'ambiguous_evidence',
  'evidence_locator_inconsistent',
  'evidence_not_in_transcript',
  'evidence_overlaps_unreliable',
  'evidence_overlaps_mechanical',
  'evidence_overlaps_metric',
  'no_answer_double_count',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => key in value)
}

function boundedText(value: unknown, max = MAX_DETAIL_LENGTH): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null
}

function nullableBoundedText(value: unknown): string | null | undefined {
  return value === null ? null : (boundedText(value) ?? undefined)
}

function overlaps(left: V3TranscriptSpan, right: V3TranscriptSpan): boolean {
  return left.start < right.end && right.start < left.end
}

function validSpan(span: V3TranscriptSpan, transcript: string): boolean {
  return (
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start &&
    span.end <= transcript.length &&
    (span.confidence === undefined || inUnitInterval(span.confidence))
  )
}

type SpanResolution =
  | { span: V3TranscriptSpan; reason: null }
  | {
      span: null
      reason: 'ambiguous_evidence' | 'evidence_locator_inconsistent' | 'evidence_not_in_transcript'
    }

function quoteOffsets(transcript: string, quote: string): number[] {
  const offsets: number[] = []
  let located = transcript.indexOf(quote)
  while (located >= 0) {
    offsets.push(located)
    located = transcript.indexOf(quote, located + 1)
  }
  return offsets
}

function resolvedTranscriptSpan(
  start: unknown,
  end: unknown,
  quote: string,
  transcript: string,
  occurrence: unknown,
): SpanResolution {
  const offsets = quoteOffsets(transcript, quote)
  if (offsets.length === 0) return { span: null, reason: 'evidence_not_in_transcript' }
  const selectedOccurrence =
    Number.isInteger(occurrence) && (occurrence as number) >= 1 ? (occurrence as number) : null
  const supplied = { start, end } as V3TranscriptSpan
  if (validSpan(supplied, transcript) && transcript.slice(supplied.start, supplied.end) === quote) {
    if (selectedOccurrence !== null && offsets[selectedOccurrence - 1] !== supplied.start) {
      return { span: null, reason: 'evidence_locator_inconsistent' }
    }
    return { span: supplied, reason: null }
  }

  if (offsets.length === 1) {
    if (selectedOccurrence !== null && selectedOccurrence !== 1) {
      return { span: null, reason: 'evidence_locator_inconsistent' }
    }
    return { span: { start: offsets[0]!, end: offsets[0]! + quote.length }, reason: null }
  }
  if (selectedOccurrence === null || selectedOccurrence > offsets.length) {
    return { span: null, reason: 'ambiguous_evidence' }
  }
  const located = offsets[selectedOccurrence - 1]!
  return { span: { start: located, end: located + quote.length }, reason: null }
}

function validMechanicalSpan(span: V3MechanicallyOwnedSpan, transcript: string): boolean {
  return (
    validSpan(span, transcript) &&
    span.category === 'false_start' &&
    span.text.length === span.end - span.start &&
    transcript.slice(span.start, span.end) === span.text
  )
}

/** Invalid and overlapping local ownership evidence is ignored, never charged twice. */
export function validMechanicalConcisenessSpans(
  spans: readonly V3MechanicallyOwnedSpan[],
  transcript: string,
): V3MechanicallyOwnedSpan[] {
  const candidates = spans
    .filter((span) => validMechanicalSpan(span, transcript))
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const accepted: V3MechanicallyOwnedSpan[] = []
  for (const span of candidates) {
    if (!accepted.some((existing) => overlaps(existing, span))) accepted.push(span)
  }
  return accepted
}

function notCheckedMetric(metric: WhatYouSaidMetricId, warning: string): V3ContentMetricResult {
  return {
    metric,
    status: 'not_checked',
    component: null,
    explanation: null,
    measurements: null,
    evidence: [],
    details: [],
    warnings: [warning],
  }
}

function notChecked(provider: string | null, warning: string, calls: number): V3ContentEvaluation {
  return {
    version: V3_CONTENT_EVALUATOR_VERSION,
    provider,
    status: 'not_checked',
    metrics: Object.fromEntries(
      WHAT_YOU_SAID_METRICS.map((metric) => [metric, notCheckedMetric(metric, warning)]),
    ) as Record<WhatYouSaidMetricId, V3ContentMetricResult>,
    warnings: [warning],
    calls,
  }
}

function diagnosticFor(
  error: unknown,
  failure: ContentProviderFailure,
): V3ContentFailureDiagnostic {
  if (error instanceof V3ContentParseError) {
    return {
      category: CONTENT_VALIDATION_REASONS.has(error.reason)
        ? 'content_validation_failed'
        : 'provider_invalid_response',
      code: error.code,
      reason: error.reason,
      metric: error.metric,
    }
  }
  const code = failure.diagnostic.code
  if (
    code === 'authentication_error' ||
    code === 'configuration_error' ||
    code === 'network_failure' ||
    code === 'rate_limit' ||
    code === 'server_error' ||
    code === 'timeout'
  ) {
    return { category: 'provider_unavailable', code, reason: null, metric: null }
  }
  if (
    code === 'empty_response' ||
    code === 'malformed_json' ||
    code === 'schema_invalid' ||
    code === 'truncated_response'
  ) {
    return { category: 'provider_invalid_response', code, reason: null, metric: null }
  }
  return { category: 'internal_error', code, reason: null, metric: null }
}

function reportFinalDiagnostic(
  input: V3ContentEvaluationInput,
  calls: number,
  diagnostic: V3ContentFailureDiagnostic,
): void {
  console.warn('[v3-content]', {
    attemptId: input.diagnosticAttemptId ?? null,
    provider: input.provider.name,
    calls,
    ...diagnostic,
  })
}

function retryInstructionFor(error: V3ContentParseError): string {
  const metric = error.metric ? ` for ${error.metric}` : ''
  if (error.reason === 'ambiguous_evidence') {
    return `The previous response used ambiguous transcript evidence${metric}. Set occurrence to the intended one-based occurrence, or copy a longer exact quote that occurs once. For a repeated idea across separated text, use null primary evidence and two or more exact supporting_spans.`
  }
  if (error.reason === 'evidence_not_in_transcript') {
    return `The previous response used evidence${metric} that did not match the transcript. Copy exact transcript text. Do not estimate offsets; expand each quote until it occurs once so offsets can be safely repaired.`
  }
  if (error.reason === 'whole_response_evidence_invalid') {
    return `The previous response used an invalid evidence shape${metric}. Use null primary evidence only for allowed whole-response findings or a repeated_idea with two or more exact supporting_spans. Every filler needs one exact contiguous quote.`
  }
  return `The previous response failed validation${metric}. Return only a corrected object that exactly follows response_shape and allowed_finding_kinds.`
}

function warningFor(diagnostic: V3ContentFailureDiagnostic): string {
  return diagnostic.category === 'provider_unavailable'
    ? V3_CONTENT_CHECK_UNAVAILABLE_MESSAGE
    : V3_CONTENT_CHECK_INVALID_MESSAGE
}

interface ParseContext {
  transcript: string
  mechanicallyOwned: readonly V3MechanicallyOwnedSpan[]
  unreliable: readonly V3TranscriptSpan[]
  claimed: V3TranscriptSpan[]
}

function claimedEvidence(
  value: unknown,
  metric: WhatYouSaidMetricId,
  context: ParseContext,
): V3ScoreEvidence {
  if (
    !isRecord(value) ||
    (!exactKeys(value, ['quote', 'start', 'end']) &&
      !exactKeys(value, ['quote', 'start', 'end', 'occurrence']))
  ) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} contained malformed supporting evidence.`,
      'evidence_not_in_transcript',
      metric,
    )
  }
  if (
    'occurrence' in value &&
    (!Number.isInteger(value.occurrence) || (value.occurrence as number) < 1)
  ) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} evidence contained an invalid occurrence.`,
      'evidence_locator_inconsistent',
      metric,
    )
  }
  const quote = boundedText(value.quote)
  const resolution = quote
    ? resolvedTranscriptSpan(value.start, value.end, quote, context.transcript, value.occurrence)
    : { span: null, reason: 'evidence_not_in_transcript' as const }
  if (!quote || !resolution.span) {
    const reason = resolution.reason ?? 'evidence_not_in_transcript'
    throw new V3ContentParseError(
      'schema_invalid',
      reason === 'ambiguous_evidence'
        ? `${metric} evidence was ambiguous in the transcript.`
        : reason === 'evidence_locator_inconsistent'
          ? `${metric} evidence locators were inconsistent.`
          : `${metric} evidence did not match the transcript.`,
      reason,
      metric,
    )
  }
  const evidenceSpan = resolution.span
  if (context.unreliable.some((candidate) => overlaps(candidate, evidenceSpan))) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} evidence overlapped unreliable transcription.`,
      'evidence_overlaps_unreliable',
      metric,
    )
  }
  if (context.mechanicallyOwned.some((candidate) => overlaps(candidate, evidenceSpan))) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} attempted to reuse mechanically owned speech.`,
      'evidence_overlaps_mechanical',
      metric,
    )
  }
  if (context.claimed.some((candidate) => overlaps(candidate, evidenceSpan))) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} attempted to reuse speech owned by another metric or finding.`,
      'evidence_overlaps_metric',
      metric,
    )
  }
  context.claimed.push(evidenceSpan)
  return {
    source: 'transcript',
    start: evidenceSpan.start,
    end: evidenceSpan.end,
    coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
    quote,
    detail: '',
  }
}

function parseFinding(
  value: unknown,
  metric: WhatYouSaidMetricId,
  context: ParseContext,
): V3MetricDetail {
  const legacyKeys = ['kind', 'quote', 'start', 'end', 'observation', 'suggestion'] as const
  const currentKeys = [
    'kind',
    'quote',
    'start',
    'end',
    'supporting_spans',
    'observation',
    'suggestion',
  ] as const
  const occurrenceKeys = [
    'kind',
    'quote',
    'start',
    'end',
    'occurrence',
    'supporting_spans',
    'observation',
    'suggestion',
  ] as const
  if (
    !isRecord(value) ||
    (!exactKeys(value, legacyKeys) &&
      !exactKeys(value, currentKeys) &&
      !exactKeys(value, occurrenceKeys))
  ) {
    throw new V3ContentParseError('schema_invalid', `${metric} contained a malformed finding.`)
  }
  const kind = boundedText(value.kind)
  const observation = boundedText(value.observation)
  const suggestion = nullableBoundedText(value.suggestion)
  if (!kind || !FINDING_KINDS[metric].includes(kind) || !observation || suggestion === undefined) {
    throw new V3ContentParseError('schema_invalid', `${metric} contained a malformed finding.`)
  }

  const supportingSpans = 'supporting_spans' in value ? value.supporting_spans : []
  if (!Array.isArray(supportingSpans) || supportingSpans.length > MAX_SUPPORTING_SPANS) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} contained malformed supporting evidence.`,
      'whole_response_evidence_invalid',
      metric,
    )
  }

  if (value.quote === null) {
    const responseLevelRepetition = metric === 'conciseness' && kind === 'repeated_idea'
    if (
      (!NULL_EVIDENCE_METRICS.has(metric) && !responseLevelRepetition) ||
      value.start !== null ||
      value.end !== null ||
      ('occurrence' in value && value.occurrence !== null)
    ) {
      throw new V3ContentParseError(
        'schema_invalid',
        `${metric} contained invalid whole-response evidence.`,
        'whole_response_evidence_invalid',
        metric,
      )
    }
    if (supportingSpans.length > 0 && (!responseLevelRepetition || supportingSpans.length < 2)) {
      throw new V3ContentParseError(
        'schema_invalid',
        `${metric} contained invalid noncontiguous evidence.`,
        'whole_response_evidence_invalid',
        metric,
      )
    }
    const evidence = supportingSpans.map((span) => ({
      ...claimedEvidence(span, metric, context),
      detail: observation,
    }))
    return { kind, source: 'ai', quote: null, observation, suggestion, evidence }
  }

  const quote = boundedText(value.quote)
  if (supportingSpans.length > 0) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} mixed contiguous and noncontiguous evidence.`,
      'whole_response_evidence_invalid',
      metric,
    )
  }
  const evidence = claimedEvidence(
    {
      quote,
      start: value.start,
      end: value.end,
      ...('occurrence' in value ? { occurrence: value.occurrence } : {}),
    },
    metric,
    context,
  )
  if (!quote) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} evidence did not match the transcript.`,
      'evidence_not_in_transcript',
      metric,
    )
  }
  return {
    kind,
    source: 'ai',
    quote,
    observation,
    suggestion,
    evidence: [{ ...evidence, detail: observation }],
  }
}

function parseMetric(
  value: unknown,
  metric: WhatYouSaidMetricId,
  context: ParseContext,
): V3ContentMetricResult {
  if (!isRecord(value) || !exactKeys(value, ['component', 'explanation', 'findings'])) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} was missing or malformed.`,
      'metric_shape_invalid',
      metric,
    )
  }
  const explanation = boundedText(value.explanation, MAX_EXPLANATION_LENGTH)
  if (!inUnitInterval(value.component) || !explanation || !Array.isArray(value.findings)) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} was missing or malformed.`,
      'metric_shape_invalid',
      metric,
    )
  }
  if (value.findings.length > MAX_FINDINGS_PER_METRIC) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} returned too many findings.`,
      'too_many_findings',
      metric,
    )
  }
  const details = value.findings.map((finding) => parseFinding(finding, metric, context))
  if (
    (value.component < 1 && details.length === 0) ||
    (value.component === 1 && details.length > 0)
  ) {
    throw new V3ContentParseError(
      'schema_invalid',
      `${metric} component and findings were inconsistent.`,
      'component_findings_inconsistent',
      metric,
    )
  }
  return {
    metric,
    status: 'scored',
    component: value.component,
    explanation,
    measurements: {},
    evidence: details.flatMap((detail) => detail.evidence),
    details,
    warnings: [],
  }
}

function mechanicalDetail(span: V3MechanicallyOwnedSpan): V3MetricDetail {
  const observation = 'This false start adds unnecessary speech.'
  const evidence: V3ScoreEvidence = {
    source: 'transcript',
    start: span.start,
    end: span.end,
    coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
    quote: span.text,
    detail: observation,
  }
  return {
    kind: span.category,
    source: 'mechanical',
    quote: span.text,
    observation,
    suggestion: 'Remove this unnecessary speech.',
    evidence: [evidence],
  }
}

function applyStructuralConciseness(
  result: V3ContentMetricResult,
  spans: readonly V3MechanicallyOwnedSpan[],
): V3ContentMetricResult {
  if (result.component === null) return result
  if (spans.length === 0) return result
  const reduction = Math.min(
    MAX_STRUCTURAL_CONCISENESS_REDUCTION,
    spans.reduce((total, span) => total + STRUCTURAL_CONCISENESS_REDUCTION[span.category], 0),
  )
  const details = spans.map(mechanicalDetail)
  const countedSpeech = `${spans.length} false-start ${spans.length === 1 ? 'span' : 'spans'}`
  return {
    ...result,
    component: Math.max(0, Number((result.component - reduction).toFixed(4))),
    explanation: `${result.explanation} You use ${countedSpeech} that ${spans.length === 1 ? 'adds' : 'add'} unnecessary speech.`,
    measurements: {
      semantic_component: result.component,
      structural_component_reduction: reduction,
    },
    evidence: [...result.evidence, ...details.flatMap((detail) => detail.evidence)],
    details: [...result.details, ...details],
  }
}

export function parseV3ContentResponse(
  raw: string,
  input: Pick<
    V3ContentEvaluationInput,
    'transcript' | 'mechanicallyOwned' | 'unreliableTranscriptSpans'
  >,
): Omit<V3ContentEvaluation, 'provider' | 'calls'> {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new V3ContentParseError(
      'malformed_json',
      'The v3 content response was not JSON.',
      'malformed_json',
    )
  }
  if (
    !isRecord(payload) ||
    !exactKeys(payload, ['version', 'metrics']) ||
    payload.version !== V3_CONTENT_EVALUATOR_VERSION ||
    !isRecord(payload.metrics) ||
    !exactKeys(payload.metrics, WHAT_YOU_SAID_METRICS)
  ) {
    throw new V3ContentParseError(
      'schema_invalid',
      'The v3 content response did not match the required envelope.',
      'envelope_invalid',
    )
  }

  const unreliable = (input.unreliableTranscriptSpans ?? []).filter((span) =>
    validSpan(span, input.transcript),
  )
  const mechanicallyOwned = validMechanicalConcisenessSpans(
    input.mechanicallyOwned ?? [],
    input.transcript,
  ).filter((span) => !unreliable.some((candidate) => overlaps(candidate, span)))
  const context: ParseContext = {
    transcript: input.transcript,
    mechanicallyOwned,
    unreliable,
    claimed: [],
  }
  const parsed = {} as Record<WhatYouSaidMetricId, V3ContentMetricResult>
  for (const metric of CLAIM_PRECEDENCE) {
    parsed[metric] = parseMetric(payload.metrics[metric], metric, context)
  }

  const noAnswer = parsed.answered_prompt.details.some(
    (detail) => detail.kind === 'no_prompt_answer',
  )
  if (
    noAnswer &&
    ([...parsed.specificity.details, ...parsed.structure.details] as V3MetricDetail[]).some(
      (detail) => detail.evidence.length === 0,
    )
  ) {
    throw new V3ContentParseError(
      'schema_invalid',
      'A missing answer was assigned to more than one whole-response metric.',
      'no_answer_double_count',
    )
  }
  parsed.conciseness = applyStructuralConciseness(parsed.conciseness, mechanicallyOwned)

  return {
    version: V3_CONTENT_EVALUATOR_VERSION,
    status: 'checked',
    metrics: parsed,
    warnings: [],
  }
}

/** Retries once for recoverable transport or strict-schema failures, then fails all six metrics. */
export async function runV3ContentEvaluation(
  input: V3ContentEvaluationInput,
): Promise<V3ContentEvaluation> {
  if (input.prompt.trim().length === 0 || input.transcript.trim().length === 0) {
    return {
      ...notChecked(
        input.provider.name,
        'A prompt and transcript are required for the content evaluation.',
        0,
      ),
      diagnostic: {
        category: 'input_invalid',
        code: 'missing_input',
        reason: null,
        metric: null,
      },
    }
  }
  const unreliableTranscriptSpans = (input.unreliableTranscriptSpans ?? []).filter((span) =>
    validSpan(span, input.transcript),
  )
  const mechanicallyOwned = validMechanicalConcisenessSpans(
    input.mechanicallyOwned ?? [],
    input.transcript,
  ).filter((span) => !unreliableTranscriptSpans.some((candidate) => overlaps(candidate, span)))

  let calls = 0
  let retryInstruction: string | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      calls += 1
      const raw = await input.provider.complete({
        version: V3_CONTENT_EVALUATOR_VERSION,
        mode: input.mode,
        prompt: input.prompt,
        transcript: input.transcript,
        mechanicallyOwned,
        unreliableTranscriptSpans,
        timeoutMs: input.timeoutMs,
        retryInstruction,
      })
      return {
        ...parseV3ContentResponse(raw, {
          transcript: input.transcript,
          mechanicallyOwned,
          unreliableTranscriptSpans,
        }),
        provider: input.provider.name,
        calls,
      }
    } catch (error) {
      const failure =
        error instanceof V3ContentParseError
          ? new ContentProviderFailure(error.code, input.provider.name)
          : reportContentProviderFailure(error, input.provider.name)
      if (attempt === 0 && isRetryableContentProviderFailure(failure)) {
        if (error instanceof V3ContentParseError) retryInstruction = retryInstructionFor(error)
        continue
      }
      const diagnostic = diagnosticFor(error, failure)
      reportFinalDiagnostic(input, calls, diagnostic)
      return {
        ...notChecked(input.provider.name, warningFor(diagnostic), calls),
        diagnostic,
      }
    }
  }
  return notChecked(input.provider.name, V3_CONTENT_CHECK_INVALID_MESSAGE, calls)
}
