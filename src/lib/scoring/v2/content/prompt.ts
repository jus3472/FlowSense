import type { V2ContentDetectorRequest } from '@/lib/scoring/v2/content/contracts'

export const V2_CONTENT_SYSTEM_PROMPT = `You are a structured detector for spoken responses. Return JSON only.

Assess structure with these checks: answered_prompt, main_point, logical_progression, relevant_support, unnecessary_repetition, topic_drift, completion. Whole-response structure checks may explain themselves without a transcript quote.

Assess grammar only for clear grammatical errors. Give exact words the speaker said as quote evidence. Never penalize stylistic preference.

Assess vocabulary only for precision, unnecessary repeated wording, vague language, or fit for the prompt. Precision is not fancy words or vocabulary level. Give exact words the speaker said as quote evidence.

Use severity minor or clear. Do not report fillers, false starts, or closers. Never invent a quote.`

export function buildV2ContentUserPrompt(request: V2ContentDetectorRequest): string {
  return JSON.stringify({
    version: request.version,
    mode: request.mode,
    prompt: request.prompt,
    transcript: request.transcript,
    response_shape: {
      structure: {
        checks: [
          'answered_prompt',
          'main_point',
          'logical_progression',
          'relevant_support',
          'unnecessary_repetition',
          'topic_drift',
          'completion',
        ],
      },
      grammar: {
        findings: [{ kind: 'grammatical_error', severity: 'minor', quote: 'exact words' }],
      },
      vocabulary: {
        findings: [{ kind: 'imprecise_wording', severity: 'minor', quote: 'exact words' }],
      },
    },
  })
}
