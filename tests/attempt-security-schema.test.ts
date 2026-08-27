import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260827000100_attempt_security_foundation.sql',
  'utf8',
)

describe('attempt security foundation migration', () => {
  it('adds a constrained lifecycle without requiring an overall score', () => {
    for (const status of ['uploading', 'transcribing', 'scoring', 'done', 'failed', 'timed_out']) {
      expect(migration).toContain(`'${status}'`)
    }
    expect(migration).toContain('add column client_request_id uuid')
    expect(migration).toContain('attempts_user_client_request_idx')
    expect(migration).toContain('attempts_user_status_created_idx')
    expect(migration).not.toMatch(/status = 'done'.+score is not null/s)
  })

  it('documents and applies conservative historical status inference', () => {
    expect(migration).toContain('A stored score or result')
    expect(migration).toMatch(/section_scores is not null\s+or content_result is not null/)
    expect(migration).toContain("else 'timed_out'")
    expect(migration).toContain("else 'legacy_incomplete'")
  })

  it('removes direct attempt mutations while preserving owner reads and server access', () => {
    expect(migration).toContain(
      'revoke insert, update, delete on public.attempts from authenticated',
    )
    expect(migration).toContain('grant select on public.attempts to authenticated')
    expect(migration).toContain(
      'grant select, insert, update, delete on public.attempts to service_role',
    )
    for (const policy of ['attempts_insert_own', 'attempts_update_own', 'attempts_delete_own']) {
      expect(migration).toContain(`drop policy if exists "${policy}"`)
    }
    expect(migration).not.toMatch(/security definer/i)
  })

  it('backfills missing profiles without overwriting existing rows', () => {
    expect(migration).toContain('from auth.users as auth_user')
    expect(migration).toContain('where profile.id is null')
    expect(migration).toContain('on conflict (id) do nothing')
  })
})
