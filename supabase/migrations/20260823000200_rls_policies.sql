-- Row level security. Every user table is scoped to auth.uid() with explicit
-- select, insert, update, and delete policies. A missing insert policy fails
-- silently at runtime, so all four are spelled out for each table.

alter table public.profiles enable row level security;
alter table public.prompts enable row level security;
alter table public.attempts enable row level security;
alter table public.note_feedback enable row level security;

grant select, insert, update, delete on public.profiles to authenticated;
grant select on public.prompts to anon, authenticated;
grant select, insert, update, delete on public.attempts to authenticated;
grant select, insert, update, delete on public.note_feedback to authenticated;

-- profiles ------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated
  using ((select auth.uid()) = id);

-- prompts -------------------------------------------------------------------
-- Shared content with no user scoping. Readable signed out so the landing page
-- can show real prompts later.
drop policy if exists "prompts_select_all" on public.prompts;
create policy "prompts_select_all" on public.prompts
  for select to anon, authenticated
  using (true);

-- attempts ------------------------------------------------------------------
drop policy if exists "attempts_select_own" on public.attempts;
create policy "attempts_select_own" on public.attempts
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "attempts_insert_own" on public.attempts;
create policy "attempts_insert_own" on public.attempts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "attempts_update_own" on public.attempts;
create policy "attempts_update_own" on public.attempts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "attempts_delete_own" on public.attempts;
create policy "attempts_delete_own" on public.attempts
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- note_feedback -------------------------------------------------------------
drop policy if exists "note_feedback_select_own" on public.note_feedback;
create policy "note_feedback_select_own" on public.note_feedback
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "note_feedback_insert_own" on public.note_feedback;
create policy "note_feedback_insert_own" on public.note_feedback
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "note_feedback_update_own" on public.note_feedback;
create policy "note_feedback_update_own" on public.note_feedback
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "note_feedback_delete_own" on public.note_feedback;
create policy "note_feedback_delete_own" on public.note_feedback
  for delete to authenticated
  using ((select auth.uid()) = user_id);
