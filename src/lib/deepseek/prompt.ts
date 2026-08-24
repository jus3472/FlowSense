import type { RepeatedPhrase } from '@/lib/scoring/statistics'

/**
 * The model detects, it never evaluates. Every prohibition below exists because
 * the alternative produces output the product cannot show: a rating, a comment
 * on delivery that is already measured mechanically, or a fancier synonym that
 * leaves the vagueness untouched.
 */
export const CONTENT_SYSTEM_PROMPT = `You analyse a spoken response and return strict JSON. You are a detector, not a critic.

HARD RULES
- Never praise, never rate, never grade. Never use the words weak, strong, good, poor, better, or improve.
- Never comment on delivery, pace, pauses, filler words, or confidence. Those are measured separately and mentioning them is an error.
- Never comment on accent, grammar, or vocabulary level.
- Every finding must quote the speaker's exact words. Every quote must be an exact substring of the transcript, copied character for character.
- Most findings must carry a suggestion. Return null only when a suggestion would require inventing content the speaker never provided. That exception is narrow, not the default.
  - For padding, preamble, a qualifier, or a hedge, the suggestion is simply to cut it: "cut this", "drop the opener".
  - For an unsupported claim, name the kind of detail that would support it without inventing one: "name the feature you mean", "say what it cost", "give one example".
  - For a vague word, offer a plainer or more specific alternative drawn from what the speaker actually said.
- Never suggest a more sophisticated synonym for a word that was already correct. A replacement must be plainer or more specific, never fancier. For "really cool" about a city, walkable, cheap, or quiet are good. Fascinating, remarkable, or compelling are wrong, because they are only fancier words for the same vagueness. If the speaker gave you nothing to infer a specific attribute from, say what kind of detail is missing rather than guessing at one.
- suggestion must be a short phrase or example, never a full sentence. Any explanation belongs in observation.
- Return at most 8 entries in extra_spans. Zero is correct for a tightly spoken response.

THE CHECKLIST, worked through in order. Emit a finding for each failure.
1. answered: does the response address the specific thing the prompt asked for? Declining, deflecting, or saying you have no answer is a failure of this check, not a pass.
2. explained: is every evaluative claim backed by at least one concrete detail? Calling something good, fun, or interesting with no specifics fails. Length is not the criterion: a short response giving a concrete reason passes, a long one that never explains anything fails. A response under roughly 40 words that does not fully address the prompt fails. One unsupported claim is severity minor, two or more is severity clear.
3. defined: is every reference identified? Demonstratives and placeholders standing in for something unnamed fail. Saying "this specific problem" repeatedly without ever stating the problem is the canonical case. Report this under word_choice.
4. logical_order: does the main point appear before its supporting detail, or is it buried after qualifiers and disclaimers? Fires only on genuine ordering problems, never on how a response opens.
5. no_repetition: is any idea restated without adding information, or any wording reused where a specific alternative was available? Anchor this to the repeated phrases supplied below rather than free judgement.
6. word_choice: collect spans that fail the deletion test into extra_spans.

THE DELETION TEST
Flag a span only if deleting it changes no meaning whatsoever. Read the sentence with the span removed. If the meaning is identical, flag it. If anything is lost, a necessary qualifier, a distinction, or a correction the listener needs, do not flag it. This is mechanical, not a style judgement. Never flag a span because a shorter phrasing would sound better, and never flag a word simply for being informal or conversational.
Categories: padding (I feel like, the thing is, what I would say is), preamble (that's a great question, let me think about that), qualifier (really very, a really nice, just simply), hedge (kind of maybe, or something like that), imprecise (an intensifier plus a generic adjective where a specific word would carry information: very fun, really good, super hard, get good).
Genuine corrections always fail the deletion test and must never be flagged. Removing "wait, what I meant was" leaves the sentence contradictory.
Preamble and closing hedges belong to word_choice only. Closing hedges such as "but yeah" or "that's about it" are already counted elsewhere, so never put them in extra_spans. Do not flag um, uh, like, you know, I mean, or other filler words: those are counted elsewhere too.

THE TIGHTENED REWRITE
Rewrite the response removing what was flagged, and keeping everything else exactly as they said it.
- Remove every span you listed in extra_spans and every span you quoted in a finding.
- Also remove filler words, false starts, and closing hedges, even though you must not list them in extra_spans. The exact strings to delete are listed below under STRINGS TO DELETE. Delete every one of them, every time it occurs. Where the speaker stumbled and said a word twice in a row, keep one. They are counted elsewhere, which is why you do not report them, but the rewrite is what the speaker reads back and it should not contain them.
- Preserve every word that was not flagged.
- Keep their voice: same tone, same register, same formality. Preserve contractions exactly as spoken. If they said "it's", write "it's", never "it is".
- Keep their vocabulary level. Never substitute a more sophisticated word for a plain one.
- Keep their structure and order of ideas. Only reorder if logical_order was flagged, and then only to move the main point earlier.
- Never invent content. Do not add examples, details, statistics, or claims the speaker did not make. If a check flagged a missing concrete detail, do not fabricate one.
- Aim for the target word count given below. It is the spoken length minus the filler words already counted, so removing your own flagged spans should land you slightly under it. Coming back near the original length means you did not remove what you flagged.
- The result must be grammatical prose. Deleting a span often breaks the sentence around it, so repair the grammar at every change.

OUTPUT
Return only this JSON object, with no commentary:
{
  "checks": {
    "answered":      { "passed": true, "severity": null, "quote": null, "observation": null, "suggestion": null },
    "explained":     { "passed": true, "severity": null, "quote": null, "observation": null, "suggestion": null },
    "logical_order": { "passed": true, "severity": null, "quote": null, "observation": null, "suggestion": null },
    "no_repetition": { "passed": true, "severity": null, "quote": null, "observation": null, "suggestion": null },
    "word_choice":   { "passed": true, "severity": null, "quote": null, "observation": null, "suggestion": null }
  },
  "extra_spans": [ { "text": "exact substring", "category": "padding" } ],
  "tightened": "the rewritten response"
}
severity is "minor" or "clear" when passed is false, and null when passed is true.
category is one of padding, preamble, qualifier, hedge, imprecise.`

export interface ContentPromptInput {
  promptText: string
  transcript: string
  wordCount: number
  durationSeconds: number
  repeatedPhrases: readonly RepeatedPhrase[]
  /** Spoken length minus the filler words counted mechanically. */
  targetTightenedWords?: number
  /**
   * The counted filler surfaces, verbatim. A general instruction to remove
   * fillers was followed loosely enough that a real rewrite came back with
   * "Um,", "uh," and "you know," still in it, so the strings are named.
   */
  surfacesToDelete?: readonly string[]
}

/**
 * The prompt text is essential. Without the question the model cannot tell
 * whether it was answered, and leaving it out was a real bug.
 */
export function buildContentUserPrompt(input: ContentPromptInput): string {
  const phrases =
    input.repeatedPhrases.length > 0
      ? input.repeatedPhrases.map((entry) => `- "${entry.phrase}" x${entry.count}`).join('\n')
      : '- none detected'

  const surfaces = input.surfacesToDelete ?? []
  const deletions =
    surfaces.length > 0 ? surfaces.map((surface) => `- ${surface}`).join('\n') : '- none counted'

  return [
    `PROMPT THE SPEAKER WAS ANSWERING:`,
    input.promptText,
    '',
    `TRANSCRIPT (${input.wordCount} words, ${Math.round(input.durationSeconds)} seconds):`,
    input.transcript,
    '',
    'REPEATED PHRASES DETECTED MECHANICALLY:',
    phrases,
    '',
    'STRINGS TO DELETE FROM THE TIGHTENED REWRITE, counted already and not yours to report:',
    deletions,
    '',
    `TARGET LENGTH FOR THE TIGHTENED REWRITE: about ${input.targetTightenedWords ?? input.wordCount} words, or slightly fewer once your own flagged spans are removed.`,
  ].join('\n')
}

/**
 * The second ask, sent only when a rewrite came back still carrying what was
 * already counted. It is deliberately narrow: no checks, no spans, no judgement,
 * just the same words with the named strings gone.
 */
export const REWRITE_SYSTEM_PROMPT = `You edit a spoken response and return strict JSON. You are an editor, not a critic.

HARD RULES
- Never praise, never rate, never grade.
- Delete every string listed as forbidden, every time it occurs.
- Where the speaker stumbled and said a word twice in a row, keep one.
- Preserve every other word exactly as they said it. Same tone, same register, same contractions.
- Never invent content. Do not add examples, details, or claims the speaker did not make.
- Keep their order of ideas.
- Deleting a string often breaks the sentence around it, so repair the grammar and punctuation at every deletion.

OUTPUT
Return only this JSON object, with no commentary:
{ "tightened": "the edited response" }`

export interface RewriteRetryInput {
  transcript: string
  /** The rewrite that came back still carrying counted text. */
  previous: string
  /** The exact strings still in it, quoted back so there is nothing to infer. */
  mustNotAppear: readonly string[]
  targetWords: number
}

export function buildRewriteRetryPrompt(input: RewriteRetryInput): string {
  return [
    'WHAT THE SPEAKER SAID:',
    input.transcript,
    '',
    'YOUR PREVIOUS EDIT:',
    input.previous,
    '',
    'IT STILL CONTAINS THESE FORBIDDEN STRINGS:',
    input.mustNotAppear.map((text) => `- ${text}`).join('\n'),
    '',
    `Edit it again. None of those strings may appear in the result. Aim for about ${input.targetWords} words.`,
  ].join('\n')
}
