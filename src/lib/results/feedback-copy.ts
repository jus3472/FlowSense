/** Light presentation edits only. Keep quoted speech and the finding's meaning intact. */
export function conversationalFeedback(text: string): string {
  return text
    .split(/(“[^”]*”|"[^"]*"|(?<!\w)'(?:[^']|(?<=\w)'(?=\w))*'(?!\w))/gu)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/\bThe response\b/g, 'Your answer')
            .replace(/\bthe response\b/g, 'your answer')
            .replace(/^The (\w+) (?:are|is) described (?:only )?as\b/g, 'You describe the $1 as')
            .replace(/^This long lead-in\b/g, 'Your lead-in')
            .replace(/\bdoes not\b/g, "doesn't")
            .replace(/\bdo not\b/g, "don't")
            .replace(/\bcannot\b/g, "can't")
            .replace(/\bis not\b/g, "isn't")
            .replace(/\bare not\b/g, "aren't")
            .replace(/\bnever closes\b/g, "doesn't close")
            .replace(/\bnever reaches\b/g, "doesn't reach")
            .replace(/\bcould be trimmed\b/g, 'can be shortened')
            .replace(
              /\bgrammatically clear and correct for spoken English\b/g,
              'clear and natural for spoken English',
            ),
    )
    .join('')
    .trim()
}

/** Stored findings can have several sentences; the preview uses one complete sentence. */
export function feedbackSentence(text: string): string {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
  const first = segmenter.segment(conversationalFeedback(text))[Symbol.iterator]().next().value
  return first?.segment.trim() ?? ''
}
