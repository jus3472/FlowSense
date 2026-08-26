import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260826000100_practice_schema.sql', 'utf8')

describe('practice schema migration', () => {
  it('keeps new prompt metadata valid for existing library rows', () => {
    expect(migration).toMatch(/add column if not exists mode text not null default 'practice'/)
    expect(migration).toMatch(/mode in \('practice', 'interview', 'presentation', 'conversation'\)/)
    expect(migration).toMatch(
      /add column if not exists difficulty text not null default 'beginner'/,
    )
    expect(migration).toMatch(/difficulty in \('beginner', 'intermediate', 'advanced'\)/)
    expect(migration).toMatch(/target_duration_seconds between 15 and 600/)
    expect(migration).toMatch(/add column if not exists collection_id text/)
  })

  it('adds nullable snapshots so custom and legacy attempts remain valid', () => {
    for (const column of [
      'practice_mode text',
      'prompt_source text',
      'prompt_difficulty text',
      'rubric_version text',
      'retry_of_attempt_id uuid',
    ]) {
      expect(migration).toContain(`add column if not exists ${column}`)
    }

    expect(migration).toMatch(/prompt_source is null or prompt_source in \('library', 'custom'\)/)
    expect(migration).not.toMatch(/prompt_id uuid not null/)
  })

  it('preserves retry history and provides the required indexes without replacing RLS', () => {
    expect(migration).toMatch(/references public\.attempts \(id\) on delete restrict/)
    expect(migration).toMatch(/attempts_retry_not_self_check/)
    expect(migration).toMatch(/attempts_user_practice_mode_created_idx/)
    expect(migration).toMatch(/attempts_retry_of_attempt_idx/)
    expect(migration).not.toMatch(/disable row level security/i)
  })
})
