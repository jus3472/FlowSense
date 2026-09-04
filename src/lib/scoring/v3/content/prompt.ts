import type { V3ContentEvaluatorRequest } from '@/lib/scoring/v3/content/contracts'

export const V3_CONTENT_SYSTEM_PROMPT = `You evaluate the content of one spoken response and return JSON only. Return exactly the object described by response_shape. Do not add an outer wrapper or extra fields.

Score only these visible metrics: answered_prompt, specificity, structure, conciseness, word_choice, and grammar. component is a normalized number from 0 through 1. Do not choose point maxima. Give one concise, second-person explanation for every metric. Every component below 1 requires at least one finding.

METRIC OWNERSHIP
- answered_prompt: only prompt coverage. Once the prompt is fully answered, irrelevant extra speech cannot lower this metric.
- specificity: concrete details, examples, reasons, evidence, experiences, outcomes, and how or why explanations.
- structure: logical order and grouping across the response, not sentence grammar.
- conciseness: filler words or phrases, repeated ideas, redundant sentences, irrelevant content, unnecessary tangents, and unnecessary qualifiers. Decide whether a word or phrase functions as unnecessary filler from its meaning and role in this response, not from a fixed vocabulary list. A word such as "like" or "honestly" is not a filler when it contributes meaning. Detect unusual or speaker-specific filler language when it adds no useful meaning. Repeated wording is not filler: use repeated_idea when the same meaning is repeated. A closer such as "that's about it" is filler only when it adds no useful meaning in this response. The Conciseness component must already include every model-owned filler finding; code does not subtract a separate per-filler amount. Do not report false starts, restarts, or abandoned phrases listed as mechanically_owned. Every filler finding must quote one exact contiguous transcript substring.
- word_choice: materially vague, imprecise, or context-inappropriate wording. Never reward sophisticated vocabulary or assess vocabulary level.
- grammar: clear spoken grammatical errors that affect correctness, clarity, or effectiveness. Do not enforce formal written style.

Do not assess delivery, pace, pauses, first-word timing, pronunciation, articulation, pitch, energy, volume, confidence, accent, charisma, professionalism, authenticity, warmth, or any other hidden quality. Do not penalize the same issue under two metrics. If the response does not answer the prompt at all, report that only under answered_prompt; specificity and structure must remain at component 1 unless the response contains an independent observable issue.

Use only the kinds in allowed_finding_kinds. Every finding must include occurrence and supporting_spans. A finding quote must copy one exact contiguous transcript substring and include its exact zero-based UTF-16 start and exclusive end offsets. occurrence is the one-based occurrence of that exact quote in the transcript. If a short quote occurs more than once, provide its intended occurrence or expand the quote with neighboring transcript words until it is unique. Code may repair bad offsets when the quote occurs once or occurrence unambiguously selects one repeated quote; it never guesses among repeated quotes. Answered_prompt, specificity, and structure may use null quote, start, end, and occurrence with an empty supporting_spans array for a whole-response finding. A repeated_idea across separated parts of the response may instead use null quote, start, end, and occurrence with two or more exact, non-overlapping supporting_spans. Do not join separated text into one quote. All other findings, including every filler, must use one contiguous quote and an empty supporting_spans array. Findings must not overlap unreliable_transcript_spans, mechanically_owned spans, or another finding. A null quote requires null start, end, and occurrence. Never invent evidence.`

const emptyMetric = (kinds: readonly string[], allowWholeResponse: boolean) => ({
  component: 0.75,
  explanation: 'Give one concise explanation of this visible metric.',
  findings: [
    {
      kind: kinds[0],
      quote: allowWholeResponse ? null : 'exact transcript words',
      start: allowWholeResponse ? null : 0,
      end: allowWholeResponse ? null : 22,
      occurrence: allowWholeResponse ? null : 1,
      supporting_spans: [],
      observation: 'Name only the issue owned by this metric.',
      suggestion: 'Give one brief, concrete next step or null.',
    },
  ],
})

export function buildV3ContentUserPrompt(request: V3ContentEvaluatorRequest): string {
  return JSON.stringify({
    version: request.version,
    mode: request.mode,
    prompt: request.prompt,
    transcript: request.transcript,
    mechanically_owned: request.mechanicallyOwned,
    unreliable_transcript_spans: request.unreliableTranscriptSpans,
    allowed_finding_kinds: {
      answered_prompt: ['no_prompt_answer', 'incomplete_prompt_coverage'],
      specificity: ['unsupported_claim', 'missing_detail', 'missing_reason', 'missing_outcome'],
      structure: ['unclear_order', 'scattered_ideas', 'misplaced_information', 'incomplete_arc'],
      conciseness: [
        'filler',
        'repeated_idea',
        'redundant_sentence',
        'irrelevant_content',
        'unnecessary_tangent',
        'unnecessary_qualifier',
      ],
      word_choice: ['vague_wording', 'imprecise_wording', 'inappropriate_wording'],
      grammar: ['grammatical_error'],
    },
    noncontiguous_repeated_idea_shape: {
      kind: 'repeated_idea',
      quote: null,
      start: null,
      end: null,
      occurrence: null,
      supporting_spans: [
        { quote: 'first exact unique transcript substring', start: 0, end: 39, occurrence: 1 },
        { quote: 'second exact unique transcript substring', start: 80, end: 120, occurrence: 1 },
      ],
      observation: 'Name the one idea repeated across these spans.',
      suggestion: 'Give one brief, concrete next step or null.',
    },
    ...(request.retryInstruction ? { retry_instruction: request.retryInstruction } : {}),
    response_shape: {
      version: request.version,
      metrics: {
        answered_prompt: emptyMetric(['no_prompt_answer', 'incomplete_prompt_coverage'], true),
        specificity: emptyMetric(
          ['unsupported_claim', 'missing_detail', 'missing_reason', 'missing_outcome'],
          true,
        ),
        structure: emptyMetric(
          ['unclear_order', 'scattered_ideas', 'misplaced_information', 'incomplete_arc'],
          true,
        ),
        conciseness: emptyMetric(
          [
            'filler',
            'repeated_idea',
            'redundant_sentence',
            'irrelevant_content',
            'unnecessary_tangent',
            'unnecessary_qualifier',
          ],
          false,
        ),
        word_choice: emptyMetric(
          ['vague_wording', 'imprecise_wording', 'inappropriate_wording'],
          false,
        ),
        grammar: emptyMetric(['grammatical_error'], false),
      },
    },
  })
}
