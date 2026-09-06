import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260906000100_user_data_deletion.sql', 'utf8')
const userSchemas = [
  'supabase/migrations/20260823000100_init_schema.sql',
  'supabase/migrations/20260828000100_curriculum_schema.sql',
  'supabase/migrations/20260828000400_practice_activity.sql',
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

describe('user data deletion migration', () => {
  it('keeps reset authenticated, transactional, and practice-data only', () => {
    const reset = migration.slice(
      migration.indexOf('create or replace function public.reset_my_progress'),
    )
    expect(reset).toContain('owner_id uuid := auth.uid()')
    expect(reset).toContain('delete from public.lesson_progress where user_id = owner_id')
    expect(reset).toContain('delete from public.practice_activity_days where user_id = owner_id')
    expect(reset).toContain('delete from public.attempts where user_id = owner_id')
    expect(reset).toContain("'audio_path', attempt.audio_path")
    expect(reset).toContain("'metrics', attempt.metrics")
    expect(reset).not.toContain('delete from public.profiles')
    expect(reset).not.toContain('delete from public.profile_path_preferences')
    expect(migration).toContain(
      'grant execute on function public.reset_my_progress() to authenticated, service_role',
    )
  })

  it('serializes attempt writes, activity recording, and deletions on one user lock', () => {
    expect(migration).toContain('create trigger attempts_lock_owner_mutation')
    expect(migration).toContain('before insert or update or delete on public.attempts')
    expect(migration).toContain('retry parent must belong to the attempt owner')
    expect(migration).toContain(
      'cross-user retry relationships must be repaired before deletion migration',
    )
    expect(migration).toContain(
      'create or replace function public.record_practice_activity_for_attempt',
    )
    expect(migration).toContain('create or replace function public.can_write_owned_recording')
    expect(migration).toContain('and public.can_write_owned_recording(name)')
    expect(migration).toContain(
      'grant execute on function public.can_write_owned_recording(text) to authenticated, service_role',
    )
    expect(migration.match(/pg_advisory_xact_lock/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('audits every current user-owned table as an Auth cascade dependency', () => {
    for (const table of ['profiles', 'attempts', 'note_feedback']) {
      expect(userSchemas).toMatch(
        new RegExp(
          `create table if not exists public\\.${table} \\([\\s\\S]+?references auth\\.users \\(id\\) on delete cascade`,
        ),
      )
    }
    for (const table of ['profile_path_preferences', 'lesson_progress', 'practice_activity_days']) {
      expect(userSchemas).toMatch(
        new RegExp(
          `create table public\\.${table} \\([\\s\\S]+?references auth\\.users \\(id\\) on delete cascade`,
        ),
      )
    }
  })

  it('rebuilds progression only from strict current results in curriculum order', () => {
    expect(migration).toContain('perform public.rebuild_owned_lesson_progress(target_user_id)')
    expect(migration).toContain('public.is_valid_current_score_payload_for_attempt')
    expect(migration).toContain("attempt.rubric_version = 'v3'")
    expect(migration).toContain("attempt.prompt_source = 'library'")
    expect(migration).toContain('progress.best_score >= 70')
    expect(migration).toContain(
      'order by attempt.score desc, attempt.finished_at desc nulls last, attempt.id desc',
    )
    const restoredTrigger = migration.slice(
      migration.lastIndexOf(
        'create or replace function public.raise_lesson_progress_from_attempt()',
      ),
      migration.indexOf('create or replace function public.record_practice_activity_for_attempt'),
    )
    expect(restoredTrigger).toContain('perform public.rebuild_owned_lesson_progress(new.user_id)')
  })

  it('protects other-user retries and feedback before cascading an attempt', () => {
    expect(migration).toContain('retry.user_id <> target_user_id')
    expect(migration).toContain('feedback.user_id <> target_user_id')
    expect(migration.match(/cross-user retry relationship blocks deletion/g)).toHaveLength(3)
    expect(migration.match(/cross-user feedback relationship blocks deletion/g)).toHaveLength(3)
  })

  it('repairs only affected activity days in each row stored timezone', () => {
    expect(migration).toContain('(deleted_completed_at at time zone activity.timezone)::date')
    expect(migration).toContain(
      'at time zone activity_record.timezone)::date = activity_record.local_date',
    )
    expect(migration).toContain(
      "attempt_section_scores ->> 'version' is distinct from 'v3.score.2'",
    )
    expect(migration).toContain('nonscored_metric_count = 0 then return false')
    expect(migration).toContain("attempt_rubric_version is distinct from 'v3'")
    expect(migration).toContain("'status', 'scored'")
    expect(migration).toContain('normalized_metric')
    expect(migration).toContain("jsonb_array_length(metric_item.value -> 'evidence') <> 0")
    expect(migration).toContain(
      'public.is_valid_current_score_payload_for_attempt(\n    validation_payload',
    )
  })
})
