import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260827000200_recording_storage_rls.sql',
  'utf8',
)

describe('recording storage hardening migration', () => {
  it('keeps owner reads and replaces only authenticated write policies', () => {
    expect(migration).not.toContain('drop policy if exists "recordings_select_own"')
    for (const policy of [
      'recordings_insert_own',
      'recordings_update_own',
      'recordings_delete_own',
    ]) {
      expect(migration).toContain(`drop policy if exists "${policy}" on storage.objects`)
    }
  })

  it('requires an exact owned uploading-attempt path for inserts and updates', () => {
    expect(migration).toContain("attempt.status = 'uploading'")
    expect(migration).toContain("attempt.metrics #>> '{upload,storage_path}' = name")
    expect(migration).toContain('attempt.user_id = (select auth.uid())')
    expect(migration).toContain('(storage.foldername(name))[1] = (select auth.uid()::text)')
    expect(migration.match(/attempt\.status = 'uploading'/g)).toHaveLength(3)
    expect(migration).toMatch(
      /create policy "recordings_update_own"[\s\S]+using \([\s\S]+with check \(/,
    )
  })

  it('removes authenticated deletion while retaining the backend boundary', () => {
    expect(migration).toContain('revoke delete on storage.objects from authenticated')
    expect(migration).toContain(
      'grant select, insert, update, delete on storage.objects to service_role',
    )
    expect(migration).not.toMatch(/create policy "recordings_delete_own"/)
  })

  it('does not add a bypass function or broaden another RLS surface', () => {
    expect(migration).not.toMatch(/security definer/i)
    expect(migration).not.toMatch(/alter table public\./i)
    expect(migration).not.toMatch(/create policy.+on public\./i)
  })
})
