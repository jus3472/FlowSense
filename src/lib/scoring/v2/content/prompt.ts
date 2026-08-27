import type { V2ContentDetectorRequest } from '@/lib/scoring/v2/content/contracts'

export const V2_CONTENT_SYSTEM_PROMPT = `You are a structured detector for spoken responses. Return JSON only.

Assess structure with these checks: answered_prompt, main_point, logical_progression, relevant_support, unnecessary_repetition, topic_drift, completion. Whole-response structure checks may explain themselves without a transcript quote.

Assess grammar only for clear grammatical errors. Give exact words the speaker said as quote evidence. Never penalize stylistic preference.

Assess vocabulary only for precision, unnecessary repeated wording, vague language, or fit for the prompt. Precision is not fancy words or vocabulary level. Give exact words the speaker said as quote evidence.

For every structure check, include passed, severity, quote, start, end, observation, and suggestion. A passed structure check uses null for severity, quote, start, end, observation, and suggestion. A failed structure check uses severity minor or clear, a nonempty observation, and string-or-null quote and suggestion. When quote is present, start and end are its exact zero-based character offsets in the transcript, with end exclusive. When quote is null, start and end are null. Grammar and vocabulary findings always include kind, severity, exact nonempty quote, its exact start and exclusive end character offsets, nonempty observation, and string-or-null suggestion.

Use severity minor or clear. Do not report fillers, false starts, or closers. Never invent a quote. The response version must exactly match the request version.`

export function buildV2ContentUserPrompt(request: V2ContentDetectorRequest): string {
  return JSON.stringify({
    version: request.version,
    mode: request.mode,
    prompt: request.prompt,
    transcript: request.transcript,
    response_shape: {
      version: request.version,
      structure: {
        checks: {
          answered_prompt: {
            passed: true,
            severity: null,
            quote: null,
            start: null,
            end: null,
            observation: null,
            suggestion: null,
          },
          main_point: {
            passed: false,
            severity: 'minor',
            quote: null,
            start: null,
            end: null,
            observation: 'The main point appears late.',
            suggestion: 'State the main point first.',
          },
          logical_progression: {
            passed: true,
            severity: null,
            quote: null,
            start: null,
            end: null,
            observation: null,
            suggestion: null,
          },
          relevant_support: {
            passed: true,
            severity: null,
            quote: null,
            start: null,
            end: null,
            observation: null,
            suggestion: null,
          },
          unnecessary_repetition: {
            passed: true,
            severity: null,
            quote: null,
            start: null,
            end: null,
            observation: null,
            suggestion: null,
          },
          topic_drift: {
            passed: true,
            severity: null,
            quote: null,
            start: null,
            end: null,
            observation: null,
            suggestion: null,
          },
          completion: {
            passed: true,
            severity: null,
            quote: null,
            start: null,
            end: null,
            observation: null,
            suggestion: null,
          },
        },
      },
      grammar: {
        findings: [
          {
            kind: 'grammatical_error',
            severity: 'minor',
            quote: 'exact transcript words',
            start: 0,
            end: 22,
            observation: 'Name the clear grammatical error.',
            suggestion: 'Give a brief corrected form.',
          },
        ],
      },
      vocabulary: {
        findings: [
          {
            kind: 'imprecise_wording',
            severity: 'minor',
            quote: 'exact transcript words',
            start: 0,
            end: 22,
            observation: 'Name the precision, repetition, vagueness, or fit issue.',
            suggestion: 'Offer a more specific phrase when useful.',
          },
        ],
      },
    },
  })
}
