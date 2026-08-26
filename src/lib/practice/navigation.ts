import type { Route } from 'next'
import {
  PRACTICE_MODES,
  PROMPT_DIFFICULTIES,
  type PracticeMode,
  type PromptDifficulty,
} from '@/lib/practice/contracts'
import { isPromptId } from '@/lib/prompts/selection'

type SearchParam = string | string[] | undefined

export const PRACTICE_MODE_OPTIONS: ReadonlyArray<{
  mode: PracticeMode
  label: string
  description: string
}> = [
  { mode: 'practice', label: 'General Practice', description: 'Speak about everyday topics.' },
  {
    mode: 'interview',
    label: 'Interviews',
    description: 'Practice clear answers to interview questions.',
  },
  {
    mode: 'presentation',
    label: 'Presentations',
    description: 'Practice sharing an idea with a group.',
  },
  {
    mode: 'conversation',
    label: 'Conversations',
    description: 'Practice a thoughtful back-and-forth.',
  },
]

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function singleValue(value: SearchParam): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function parsePracticeMode(value: unknown): PracticeMode | null {
  return includes(PRACTICE_MODES, value) ? value : null
}

export function parsePracticeBrowseParams(params: {
  difficulty?: SearchParam
  collection?: SearchParam
}): { difficulty?: PromptDifficulty; collectionId?: string } {
  const difficulty = singleValue(params.difficulty)
  const collectionId = singleValue(params.collection)

  return {
    ...(includes(PROMPT_DIFFICULTIES, difficulty) ? { difficulty } : {}),
    ...(collectionId && /^[a-z]+(?:_[a-z]+)*$/.test(collectionId) ? { collectionId } : {}),
  }
}

/** Missing stays undefined, while malformed or repeated prompt IDs fail closed. */
export function parseRecordPromptParam(value: SearchParam): string | null | undefined {
  if (value === undefined) return undefined
  const promptId = singleValue(value)
  return promptId && isPromptId(promptId) ? promptId : null
}

export function practiceBrowseHref(
  mode: PracticeMode,
  filters: { difficulty?: PromptDifficulty; collectionId?: string } = {},
): Route {
  const params = new URLSearchParams()
  if (filters.difficulty) params.set('difficulty', filters.difficulty)
  if (filters.collectionId) params.set('collection', filters.collectionId)
  const query = params.toString()
  return `/practice/${mode}${query ? `?${query}` : ''}` as Route
}

export function recordHrefForPrompt(promptId: string): Route {
  return `/record?prompt=${encodeURIComponent(promptId)}` as Route
}

export function formatExpectedDuration(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  }
  return `About ${seconds} seconds`
}

export function collectionLabel(collectionId: string): string {
  return collectionId.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}
