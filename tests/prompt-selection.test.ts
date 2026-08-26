import { describe, expect, it } from 'vitest'
import {
  choosePrompt,
  derivePromptCollections,
  filterPromptLibrary,
  parseLibraryPrompt,
  type LibraryPrompt,
} from '@/lib/prompts/selection'

const FIRST_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_ID = '22222222-2222-4222-8222-222222222222'
const THIRD_ID = '33333333-3333-4333-8333-333333333333'

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FIRST_ID,
    text: 'Describe a small change you would make.',
    active: true,
    mode: 'practice',
    difficulty: 'beginner',
    target_duration_seconds: 30,
    collection_id: 'storytelling',
    ...overrides,
  }
}

function prompt(id: string): LibraryPrompt {
  const parsed = parseLibraryPrompt(row({ id }))
  if (!parsed) throw new Error('Test prompt was malformed.')
  return parsed
}

describe('prompt selection', () => {
  it('filters active library rows by mode, difficulty, and collection or category', () => {
    const rows = [
      row(),
      row({ id: SECOND_ID, mode: 'interview', difficulty: 'advanced', collection_id: 'behavioral' }),
      row({ id: THIRD_ID, difficulty: 'advanced' }),
    ]

    expect(filterPromptLibrary(rows, { mode: 'practice', difficulty: 'advanced' })).toEqual([
      { ...prompt(THIRD_ID), difficulty: 'advanced' },
    ])
    expect(filterPromptLibrary(rows, { collectionId: 'storytelling' })).toEqual([
      prompt(FIRST_ID),
      { ...prompt(THIRD_ID), difficulty: 'advanced' },
    ])
    expect(filterPromptLibrary(rows, { category: 'behavioral' })).toEqual([
      {
        ...prompt(SECOND_ID),
        mode: 'interview',
        difficulty: 'advanced',
        collectionId: 'behavioral',
      },
    ])
    expect(filterPromptLibrary(rows, { collectionId: 'storytelling', category: 'behavioral' })).toEqual([])
  })

  it('derives mode-scoped, sorted collections and counts only prompts with a collection', () => {
    const prompts = [
      prompt(FIRST_ID),
      { ...prompt(SECOND_ID), mode: 'interview' as const, collectionId: 'behavioral' },
      { ...prompt(THIRD_ID), collectionId: 'storytelling' },
      { ...prompt('55555555-5555-4555-8555-555555555555'), mode: 'interview' as const },
      { ...prompt('44444444-4444-4444-8444-444444444444'), collectionId: null },
    ]

    expect(derivePromptCollections(prompts)).toEqual([
      { id: 'behavioral', mode: 'interview', promptCount: 1 },
      { id: 'storytelling', mode: 'interview', promptCount: 1 },
      { id: 'storytelling', mode: 'practice', promptCount: 2 },
    ])
  })

  it('injects deterministic random selection and safely handles boundaries', () => {
    const candidates = [prompt(FIRST_ID), prompt(SECOND_ID), prompt(THIRD_ID)]

    expect(choosePrompt(candidates, () => 0)).toEqual(candidates[0])
    expect(choosePrompt(candidates, () => 0.5)).toEqual(candidates[1])
    expect(choosePrompt(candidates, () => 1)).toEqual(candidates[2])
    expect(choosePrompt(candidates, () => -1)).toEqual(candidates[0])
    expect(choosePrompt(candidates, () => Number.NaN)).toEqual(candidates[0])
  })

  it('excludes recent prompts and safely ignores invalid, inactive, and malformed rows', () => {
    const rows = [
      row(),
      row({ id: SECOND_ID, active: false }),
      row({ id: THIRD_ID, target_duration_seconds: 12 }),
      row({ id: 'not-an-id' }),
    ]

    expect(filterPromptLibrary(rows, { excludeIds: [FIRST_ID] })).toEqual([])
    expect(filterPromptLibrary(rows)).toEqual([prompt(FIRST_ID)])
  })

  it('returns empty collections and no selection for empty candidates', () => {
    expect(filterPromptLibrary([])).toEqual([])
    expect(derivePromptCollections([])).toEqual([])
    expect(choosePrompt([], () => 0.5)).toBeNull()
  })
})
