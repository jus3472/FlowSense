import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve('supabase/migrations/20260826000200_prompt_taxonomy.sql'),
  'utf8',
)

const EXPECTED_CATEGORIES = {
  practice: ['explanation', 'opinion', 'storytelling', 'persuasion', 'spontaneous_description'],
  interview: [
    'background',
    'behavioral',
    'conflict',
    'failure',
    'leadership',
    'motivation',
    'problem_solving',
  ],
  presentation: [
    'explain_idea',
    'pitch',
    'persuade',
    'summarize',
    'teach',
    'defend_recommendation',
  ],
  conversation: [
    'disagreement',
    'giving_feedback',
    'asking_clarification',
    'raising_concern',
    'setting_boundary',
    'explaining_decision',
  ],
} as const

const rows = [
  ...migration.matchAll(
    /^\s{4}\('(.+)', '(practice|interview|presentation|conversation)', '(easy|medium|hard)', (\d+), '([a-z_]+)'\),?$/gm,
  ),
].map(([, text, mode, difficulty, duration, category]) => ({
  text,
  mode,
  difficulty,
  duration,
  category,
}))
const promptRows = [...new Map(rows.map((row) => [row.text, row])).values()]

describe('prompt taxonomy migration', () => {
  it('relies on the practice schema fields and preserves seeded prompt history', () => {
    expect(migration).toContain('update public.prompts as prompt')
    expect(migration).toContain(
      'insert into public.prompts (text, mode, difficulty, target_duration_seconds, collection_id)',
    )
    expect(migration).not.toMatch(/alter table public\.prompts\s+add column/i)
    expect(migration).toContain('where prompt.text = catalog.text')
  })

  it('provides at least ten active prompts and all difficulty levels in each mode', () => {
    for (const mode of Object.keys(EXPECTED_CATEGORIES)) {
      const prompts = promptRows.filter((row) => row.mode === mode)
      expect(prompts.length).toBeGreaterThanOrEqual(10)
      expect(new Set(prompts.map((row) => row.difficulty))).toEqual(
        new Set(['easy', 'medium', 'hard']),
      )
    }
  })

  it('covers every stable category with complete, sensible metadata', () => {
    for (const [mode, categories] of Object.entries(EXPECTED_CATEGORIES)) {
      const modeCategories = new Set(
        promptRows.filter((row) => row.mode === mode).map((row) => row.category),
      )
      expect(modeCategories).toEqual(new Set(categories))
    }

    expect(promptRows).toHaveLength(60)
    for (const row of promptRows) {
      expect(row.text).not.toHaveLength(0)
      expect(Number(row.duration)).toBeGreaterThanOrEqual(30)
      expect(Number(row.duration)).toBeLessThanOrEqual(60)
    }
  })
})
