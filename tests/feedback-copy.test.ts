import { describe, expect, it } from 'vitest'
import { conversationalFeedback, feedbackSentence } from '@/lib/results/feedback-copy'

describe('feedback presentation copy', () => {
  it('softens the narration without changing quoted speech', () => {
    expect(
      conversationalFeedback(
        'The response does not explain “it is not easy.” You do not need to repeat "I cannot go" or \'I do not know\'.',
      ),
    ).toBe(
      "Your answer doesn't explain “it is not easy.” You don't need to repeat \"I cannot go\" or 'I do not know'.",
    )
    expect(conversationalFeedback("You do not explain 'I don't know why it is not ready'.")).toBe(
      "You don't explain 'I don't know why it is not ready'.",
    )
  })

  it('keeps decimals and complete sentences intact in summaries', () => {
    expect(
      feedbackSentence('You pause for 1.6 seconds within your thought. Try finishing the phrase.'),
    ).toBe('You pause for 1.6 seconds within your thought.')
    expect(feedbackSentence('The response gives a reason but does not include the takeaway.')).toBe(
      "Your answer gives a reason but doesn't include the takeaway.",
    )
  })
})
