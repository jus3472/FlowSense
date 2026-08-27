import { describe, expect, it } from 'vitest'
import {
  buildPromptBrowseData,
  choosePrompt,
  choosePromptByModePriority,
  choosePromptForRecord,
  choosePromptWithRecentFallback,
  derivePromptCollections,
  filterPromptLibrary,
  isCompletedPromptAttempt,
  parseLibraryPrompt,
  recentCompletedLibraryPromptIds,
  type LibraryPrompt,
} from '@/lib/prompts/selection'
import { SKILL_CATEGORIES } from '@/lib/practice/contracts'
import { rubricFor } from '@/lib/scoring/v2/rubrics'

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

function partialV2Snapshot() {
  const rubric = rubricFor('practice')
  return {
    version: 'v2.score.1',
    rubric_version: 'v2',
    mode: 'practice',
    total_earned_points: null,
    total_max_points: 100,
    categories: Object.fromEntries(
      SKILL_CATEGORIES.map((category) => [
        category,
        {
          category,
          availability: 'available',
          status: 'not_checked',
          component: null,
          earned_points: null,
          max_points: rubric.categories[category].weight,
        },
      ]),
    ),
    warnings: [],
  }
}

describe('prompt selection', () => {
  it('uses ordered modes and falls back when the first has no prompt', () => {
    const practice = prompt(FIRST_ID)
    const presentation = { ...prompt(SECOND_ID), mode: 'presentation' as const }
    expect(
      choosePromptByModePriority([practice, presentation], ['interview', 'presentation']),
    ).toBe(presentation)
    expect(choosePromptByModePriority([practice], ['interview'])).toBe(practice)
  })
  it('filters active library rows by mode, difficulty, and collection or category', () => {
    const rows = [
      row(),
      row({
        id: SECOND_ID,
        mode: 'interview',
        difficulty: 'advanced',
        collection_id: 'behavioral',
      }),
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
    expect(
      filterPromptLibrary(rows, { collectionId: 'storytelling', category: 'behavioral' }),
    ).toEqual([])
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

  it('prefers a non-recent prompt and falls back after the eligible pool is exhausted', () => {
    const candidates = [prompt(FIRST_ID), prompt(SECOND_ID), prompt(THIRD_ID)]

    expect(choosePromptWithRecentFallback(candidates, [FIRST_ID, SECOND_ID], () => 0)).toEqual(
      candidates[2],
    )
    expect(
      choosePromptWithRecentFallback(candidates, [FIRST_ID, SECOND_ID, THIRD_ID], () => 0.5),
    ).toEqual(candidates[1])
  })

  it('never falls back to General Practice for an explicit empty mode', () => {
    const practice = prompt(FIRST_ID)

    expect(choosePromptForRecord([practice], 'interview', [], [], () => 0)).toBeNull()
    expect(choosePromptForRecord([practice], undefined, ['interview'], [], () => 0)).toEqual(
      practice,
    )
  })

  it('derives browse prompts, collections, and recommendation from one prompt snapshot', () => {
    const prompts = [
      prompt(FIRST_ID),
      { ...prompt(SECOND_ID), difficulty: 'advanced' as const },
      { ...prompt(THIRD_ID), mode: 'interview' as const, collectionId: 'behavioral' },
    ]

    expect(
      buildPromptBrowseData(
        prompts,
        { mode: 'practice', difficulty: 'advanced' },
        [FIRST_ID],
        () => 0,
      ),
    ).toEqual({
      prompts: [{ ...prompt(SECOND_ID), difficulty: 'advanced' }],
      collections: [{ id: 'storytelling', mode: 'practice', promptCount: 1 }],
      recommended: { ...prompt(SECOND_ID), difficulty: 'advanced' },
    })
  })

  it('treats a completed partial v2 snapshot as recent even when overall score is null', () => {
    const partial = partialV2Snapshot()
    expect(isCompletedPromptAttempt({ score: null, section_scores: partial })).toBe(true)
    expect(
      recentCompletedLibraryPromptIds([
        {
          prompt_id: FIRST_ID,
          prompt_source: 'library',
          score: null,
          section_scores: partial,
        },
        {
          prompt_id: SECOND_ID,
          prompt_source: null,
          score: 72,
          section_scores: null,
        },
      ]),
    ).toEqual([FIRST_ID, SECOND_ID])
  })

  it('returns empty collections and no selection for empty candidates', () => {
    expect(filterPromptLibrary([])).toEqual([])
    expect(derivePromptCollections([])).toEqual([])
    expect(choosePrompt([], () => 0.5)).toBeNull()
  })
})
