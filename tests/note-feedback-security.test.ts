import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260827000300_note_feedback_write_boundary.sql',
  'utf8',
)

describe('note feedback write boundary migration', () => {
  it('keeps owner reads while removing every browser write privilege and policy', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(migration).toContain(
        `revoke insert, update, delete on public.note_feedback from ${role}`,
      )
    }
    expect(migration).toContain('grant select on public.note_feedback to authenticated')
    expect(migration).not.toContain('drop policy if exists "note_feedback_select_own"')
    for (const policy of [
      'note_feedback_insert_own',
      'note_feedback_update_own',
      'note_feedback_delete_own',
    ]) {
      expect(migration).toContain(`drop policy if exists "${policy}"`)
    }
  })

  it('retains service-role CRUD and makes exact repeated writes idempotent', () => {
    expect(migration).toContain(
      'grant select, insert, update, delete on public.note_feedback to service_role',
    )
    expect(migration).toContain('note_feedback_exact_dispute_idx')
    expect(migration).toContain('nulls not distinct')
    expect(migration).toContain("current_setting('server_version_num')::integer < 150000")
    expect(migration).toMatch(
      /delete from public\.note_feedback as duplicate[\s\S]+using public\.note_feedback as retained/,
    )
  })

  it('locks writes until cleanup, uniqueness, and trigger enforcement are installed', () => {
    const lock = migration.indexOf('lock table public.note_feedback in share row exclusive mode')
    const cleanup = migration.indexOf('delete from public.note_feedback as feedback')
    const deduplicate = migration.indexOf('delete from public.note_feedback as duplicate')
    const uniqueIndex = migration.indexOf('create unique index note_feedback_exact_dispute_idx')
    const trigger = migration.indexOf('create trigger note_feedback_enforce_target')

    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(cleanup)
    expect(lock).toBeLessThan(deduplicate)
    expect(lock).toBeLessThan(uniqueIndex)
    expect(lock).toBeLessThan(trigger)
  })

  it('rejects forged service-role inserts and updates at a non-definer trigger boundary', () => {
    expect(migration).toContain('create or replace function public.enforce_note_feedback_target()')
    expect(migration).toContain('before insert or update on public.note_feedback')
    expect(migration).toContain("attempt.status = 'done'")
    expect(migration).toContain(
      "raise exception 'note feedback must match an exact checked legacy finding'",
    )
    expect(migration).not.toMatch(/security definer/i)
  })

  it('removes historical rows that do not match an exact checked legacy finding', () => {
    expect(migration).toContain("attempt.content_result ->> 'status' = 'checked'")
    expect(migration).toContain("feedback.note_type = 'word_choice_span'")
    expect(migration).toContain("span ->> 'text' = feedback.quote")
    expect(migration).toContain("attempt.content_result -> 'checks' -> feedback.note_type")
    expect(migration).toContain("not (coalesce(attempt.section_scores, '{}'::jsonb) ? 'version')")
    expect(migration).toContain('feedback.user_id = attempt.user_id')
  })

  it('does not alter stored attempt snapshots', () => {
    expect(migration).not.toMatch(/(?:update|delete from) public\.attempts/i)
  })
})
