import type { V3ContentEvaluatorRequest } from '@/lib/scoring/v3/content/contracts'

export const V3_CONTENT_SYSTEM_PROMPT = `You evaluate the content of one spoken response and return JSON only. Return exactly the object described by response_shape. Do not add an outer wrapper or extra fields.

Score only these visible metrics: answered_prompt, specificity, structure, conciseness, word_choice, and grammar. component is a normalized number from 0 through 1. Do not choose point maxima. Give one concise, second-person explanation for every metric. Every component below 1 requires at least one finding.

METRIC OWNERSHIP
- answered_prompt: only prompt coverage. Once the prompt is fully answered, irrelevant extra speech cannot lower this metric.
- specificity: concrete details, examples, reasons, evidence, experiences, outcomes, and how or why explanations.
- structure: logical order and grouping across the response, not sentence grammar.
- conciseness: only semantic repeated ideas, redundant sentences, irrelevant content, unnecessary tangents, and unnecessary qualifiers. Do not report fillers, false starts, abandoned phrases, or closers listed as mechanically_owned; code assigns those only to Conciseness. For a repeated idea in separated sentences, use null quote, start, and end rather than joining non-contiguous text. Otherwise quote one exact contiguous transcript substring.
- word_choice: materially vague, imprecise, or context-inappropriate wording. Never reward sophisticated vocabulary or assess vocabulary level.
- grammar: clear spoken grammatical errors that affect correctness, clarity, or effectiveness. Do not enforce formal written style.

Do not assess delivery, pace, pauses, first-word timing, pronunciation, articulation, pitch, energy, volume, confidence, accent, charisma, professionalism, authenticity, warmth, or any other hidden quality. Do not penalize the same issue under two metrics. If the response does not answer the prompt at all, report that only under answered_prompt; specificity and structure must remain at component 1 unless the response contains an independent observable issue.

Use only the finding kinds shown in response_shape. A finding quote must copy one exact contiguous transcript substring and include its exact zero-based UTF-16 start and exclusive end offsets. Code verifies offsets and may repair them only when the quote occurs exactly once. Answered_prompt, specificity, and structure may use null quote, start, and end for a whole-response finding. Conciseness may also use null values for a repeated_idea that spans separated sentences. Findings must not overlap unreliable_transcript_spans, mechanically_owned spans, or another finding. A null quote requires null start and end. Never invent evidence.`

const emptyMetric = (kinds: readonly string[], allowWholeResponse: boolean) => ({
  component: 0.75,
  explanation: 'Give one concise explanation of this visible metric.',
  findings: [
    {
      kind: kinds[0],
      quote: allowWholeResponse ? null : 'exact transcript words',
      start: allowWholeResponse ? null : 0,
      end: allowWholeResponse ? null : 22,
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
            'repeated_idea',
            'redundant_sentence',
            'irrelevant_content',
            'unnecessary_tangent',
            'unnecessary_qualifier',
          ],
          true,
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
