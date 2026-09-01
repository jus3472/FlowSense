-- Replace Supabase default table and function privileges with the explicit
-- least-privilege model used by the curriculum and activity boundaries.
-- This migration is intentionally object-scoped and does not change RLS,
-- global default privileges, or stored data.

revoke all privileges on table
  public.practice_paths,
  public.practice_chapters,
  public.practice_lessons
from public, anon, authenticated, service_role;

grant select on table
  public.practice_paths,
  public.practice_chapters,
  public.practice_lessons
to anon, authenticated;

grant select, insert, update, delete on table
  public.practice_paths,
  public.practice_chapters,
  public.practice_lessons
to service_role;

revoke all privileges on table
  public.profile_path_preferences,
  public.lesson_progress,
  public.practice_activity_days
from public, anon, authenticated, service_role;

grant select on table
  public.profile_path_preferences,
  public.lesson_progress,
  public.practice_activity_days
to authenticated;

grant select, insert, update, delete on table
  public.profile_path_preferences,
  public.lesson_progress
to service_role;

grant select, insert on table public.practice_activity_days to service_role;

-- The preference replacement RPC and timezone validator are the only
-- curriculum/activity functions invoked by an authenticated application user.
revoke all privileges on function public.replace_profile_path_preferences(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.replace_profile_path_preferences(uuid[])
  to authenticated, service_role;

revoke all privileges on function public.is_valid_iana_timezone(text)
  from public, anon, authenticated, service_role;
grant execute on function public.is_valid_iana_timezone(text)
  to authenticated, service_role;

-- Trigger and integrity helpers remain owner-controlled and available to the
-- trusted service role, but are not directly executable by browser roles.
revoke all privileges on function public.handle_new_user()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.raise_lesson_progress_from_attempt()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.is_valid_v2_score_payload_for_attempt(
  jsonb,
  text,
  integer,
  boolean
) from public, anon, authenticated, service_role;
revoke all privileges on function public.enforce_lesson_progress_integrity()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.enforce_practice_path_identity()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.enforce_practice_chapter_identity()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.enforce_practice_lesson_identity()
  from public, anon, authenticated, service_role;

grant execute on function public.handle_new_user() to service_role;
grant execute on function public.raise_lesson_progress_from_attempt() to service_role;
grant execute on function public.is_valid_v2_score_payload_for_attempt(
  jsonb,
  text,
  integer,
  boolean
) to service_role;
grant execute on function public.enforce_lesson_progress_integrity() to service_role;
grant execute on function public.enforce_practice_path_identity() to service_role;
grant execute on function public.enforce_practice_chapter_identity() to service_role;
grant execute on function public.enforce_practice_lesson_identity() to service_role;
