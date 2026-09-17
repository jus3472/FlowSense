'use client'

import { useRef, useState } from 'react'
import { beginCustomPractice } from '@/actions/custom-practice'
import { Button } from '@/components/ui/button'
import { SelectControl } from '@/components/ui/select-control'
import { FIELD_CONTROL_CLASS } from '@/components/ui/text-field'
import { TRACK_IDENTITIES } from '@/lib/curriculum/track-identity'

export const CUSTOM_PROMPT_EXAMPLES = [
  'Tell me about a challenge you overcame.',
  'Explain a complex idea to a beginner.',
  'Give a short product pitch.',
] as const

const CATEGORY_OPTIONS = [
  { value: 'practice', label: TRACK_IDENTITIES['general-speaking'].title },
  { value: 'interview', label: TRACK_IDENTITIES.interviews.title },
  { value: 'presentation', label: TRACK_IDENTITIES.presentations.title },
  { value: 'conversation', label: TRACK_IDENTITIES.conversations.title },
  { value: 'other', label: 'Other' },
] as const

export function CustomPromptForm({ errorCode }: { errorCode?: string }) {
  const [prompt, setPrompt] = useState('')
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const error = errorCode === 'invalid'
  const tooLarge = errorCode === 'too-large'

  function applyExample(example: string) {
    setPrompt(example)
    promptRef.current?.focus()
  }

  return (
    <form action={beginCustomPractice} className="flex flex-col gap-6">
      {error || tooLarge ? (
        <p role="alert" className="bg-negative-soft text-negative rounded-input px-4 py-3 text-sm">
          {tooLarge
            ? 'Your prompt is too long. Shorten it and try again.'
            : 'Check the prompt, category, and response length.'}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <label htmlFor="custom-prompt" className="text-foreground text-sm font-medium">
          Prompt or question
        </label>
        <textarea
          ref={promptRef}
          id="custom-prompt"
          name="prompt"
          required
          maxLength={1000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className={`${FIELD_CONTROL_CLASS} min-h-28 py-3`}
        />
        <div aria-label="Example prompts" className="flex flex-wrap gap-2">
          {CUSTOM_PROMPT_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => applyExample(example)}
              className="border-border bg-surface text-foreground hover:bg-surface-sunken focus-visible:ring-accent-ink min-h-11 rounded-full border px-4 text-left text-sm transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="custom-category" className="text-foreground text-sm font-medium">
          Category
        </label>
        <p id="custom-category-help" className="text-muted text-sm">
          Choose where this response appears in History and Progress.
        </p>
        <SelectControl
          id="custom-category"
          name="category"
          defaultValue="practice"
          aria-describedby="custom-category-help"
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectControl>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="custom-response-length" className="text-foreground text-sm font-medium">
          Planned response length
        </label>
        <p id="custom-response-length-help" className="text-muted text-sm">
          Choose how long you plan to speak, from 15 to 60 seconds.
        </p>
        <input
          id="custom-response-length"
          name="target_duration_seconds"
          type="number"
          min="15"
          max="60"
          defaultValue="60"
          aria-describedby="custom-response-length-help"
          className={FIELD_CONTROL_CLASS}
        />
      </div>

      <Button type="submit" size="lg" fullWidth>
        Continue to record
      </Button>
    </form>
  )
}
