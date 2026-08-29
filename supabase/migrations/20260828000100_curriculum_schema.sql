-- Structured curriculum, durable lesson achievement, and ranked path preferences.
-- Existing prompt and attempt rows receive additive defaults only. Historical
-- attempt snapshots remain authoritative and keep a null lesson identity.

alter table public.prompts
  add column if not exists free_practice_visible boolean not null default true;

create table public.practice_paths (
  id uuid primary key,
  slug text not null unique
    check (slug ~ '^[a-z]+(?:-[a-z]+)*$'),
  title text not null check (btrim(title) <> ''),
  mode text not null unique
    check (mode in ('practice', 'interview', 'presentation', 'conversation')),
  position integer not null unique check (position between 1 and 4),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.practice_chapters (
  id uuid primary key,
  path_id uuid not null references public.practice_paths (id) on delete restrict,
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  title text not null check (btrim(title) <> ''),
  position integer not null check (position between 1 and 3),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (path_id, level),
  unique (path_id, position),
  check (
    (level = 'beginner' and position = 1)
    or (level = 'intermediate' and position = 2)
    or (level = 'advanced' and position = 3)
  )
);

create table public.practice_lessons (
  id uuid primary key,
  chapter_id uuid not null references public.practice_chapters (id) on delete restrict,
  slug text not null unique
    check (slug ~ '^[a-z]+(?:-[a-z0-9]+)*$'),
  title text not null check (btrim(title) <> ''),
  skill_focus text not null check (btrim(skill_focus) <> ''),
  position integer not null check (position between 1 and 10),
  checkpoint boolean not null default false,
  prompt_id uuid not null unique references public.prompts (id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (chapter_id, position),
  -- Position 10 is always the chapter checkpoint and no earlier lesson can be one.
  check (checkpoint = (position = 10))
);

alter table public.attempts
  add column if not exists lesson_id uuid
    references public.practice_lessons (id) on delete restrict;

create index prompts_active_free_practice_idx
  on public.prompts (mode, difficulty, created_at)
  where active and free_practice_visible;

create index attempts_user_lesson_status_finished_idx
  on public.attempts (user_id, lesson_id, status, finished_at desc)
  where lesson_id is not null;

create table public.profile_path_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  path_id uuid not null references public.practice_paths (id) on delete restrict,
  rank integer not null check (rank between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, path_id),
  unique (user_id, rank)
);

create table public.lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id uuid not null references public.practice_lessons (id) on delete restrict,
  best_score integer not null check (best_score between 0 and 100),
  best_attempt_id uuid references public.attempts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create index lesson_progress_user_updated_idx
  on public.lesson_progress (user_id, updated_at desc);

create or replace function public.enforce_practice_path_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.slug is distinct from old.slug
    or new.mode is distinct from old.mode then
    raise exception 'practice path identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger practice_paths_enforce_identity
  before update on public.practice_paths
  for each row execute function public.enforce_practice_path_identity();

create or replace function public.enforce_practice_chapter_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.path_id is distinct from old.path_id
    or new.level is distinct from old.level then
    raise exception 'practice chapter identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger practice_chapters_enforce_identity
  before update on public.practice_chapters
  for each row execute function public.enforce_practice_chapter_identity();

create or replace function public.enforce_practice_lesson_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.chapter_id is distinct from old.chapter_id
    or new.slug is distinct from old.slug
    or new.prompt_id is distinct from old.prompt_id then
    raise exception 'practice lesson identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger practice_lessons_enforce_identity
  before update on public.practice_lessons
  for each row execute function public.enforce_practice_lesson_identity();

-- Preferences are replaced in one transaction so a browser cannot leave gaps,
-- duplicate ranks, or a profile without a primary path.
create or replace function public.replace_profile_path_preferences(path_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  path_count integer := coalesce(array_length(path_ids, 1), 0);
  distinct_path_count integer;
  active_path_count integer;
begin
  if owner_id is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if path_count < 1 or path_count > 4 or array_position(path_ids, null) is not null then
    raise exception 'path preferences require one to four path ids' using errcode = '23514';
  end if;

  select count(distinct path_id)::integer
  into distinct_path_count
  from unnest(path_ids) as requested(path_id);
  if distinct_path_count <> path_count then
    raise exception 'path preferences must be distinct' using errcode = '23514';
  end if;

  select count(*)::integer
  into active_path_count
  from public.practice_paths as path
  where path.id = any(path_ids) and path.active;
  if active_path_count <> path_count then
    raise exception 'path preferences must reference active paths' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  delete from public.profile_path_preferences where user_id = owner_id;
  insert into public.profile_path_preferences (user_id, path_id, rank)
  select owner_id, requested.path_id, requested.ordinality::integer - 1
  from unnest(path_ids) with ordinality as requested(path_id, ordinality);
end;
$$;

-- Mirrors the score-affecting core of the application decoder for the frozen
-- v2.score.1/v2 definition. Database-derived achievements must fail closed if
-- a stored server result does not match its mode's exact category contract.
create or replace function public.is_valid_v2_score_payload_for_attempt(
  payload jsonb,
  attempt_mode text,
  attempt_score integer,
  require_complete boolean
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item record;
  expected_max integer;
  category_count integer := 0;
  scored_count integer := 0;
  earned_sum numeric := 0;
  component numeric;
  earned numeric;
begin
  if require_complete is null
    or jsonb_typeof(payload) is distinct from 'object'
    or payload ->> 'version' is distinct from 'v2.score.1'
    or payload ->> 'rubric_version' is distinct from 'v2'
    or payload ->> 'mode' is distinct from attempt_mode
    or attempt_mode not in ('practice', 'interview', 'presentation', 'conversation')
    or jsonb_typeof(payload -> 'total_max_points') is distinct from 'number'
    or (payload ->> 'total_max_points')::numeric <> 100
    or jsonb_typeof(payload -> 'categories') is distinct from 'object'
    or jsonb_typeof(payload -> 'warnings') is distinct from 'array'
    or exists (
      select 1 from jsonb_array_elements(payload -> 'warnings') as warning(value)
      where jsonb_typeof(warning.value) <> 'string'
    ) then
    return false;
  end if;

  for item in select key, value from jsonb_each(payload -> 'categories')
  loop
    category_count := category_count + 1;
    expected_max := case attempt_mode
      when 'practice' then case item.key
        when 'fluency' then 22 when 'clarity' then 20 when 'vocabulary' then 12
        when 'grammar' then 12 when 'structure' then 18 when 'delivery' then 16
      end
      when 'interview' then case item.key
        when 'fluency' then 18 when 'clarity' then 22 when 'vocabulary' then 14
        when 'grammar' then 12 when 'structure' then 22 when 'delivery' then 12
      end
      when 'presentation' then case item.key
        when 'fluency' then 16 when 'clarity' then 20 when 'vocabulary' then 14
        when 'grammar' then 10 when 'structure' then 20 when 'delivery' then 20
      end
      when 'conversation' then case item.key
        when 'fluency' then 24 when 'clarity' then 22 when 'vocabulary' then 12
        when 'grammar' then 12 when 'structure' then 14 when 'delivery' then 16
      end
    end;

    if expected_max is null
      or jsonb_typeof(item.value) is distinct from 'object'
      or item.value ->> 'category' is distinct from item.key
      or jsonb_typeof(item.value -> 'max_points') is distinct from 'number'
      or (item.value ->> 'max_points')::numeric <> expected_max
      or not (item.value ? 'measurements')
      or jsonb_typeof(item.value -> 'evidence') is distinct from 'array'
      or jsonb_typeof(item.value -> 'deductions') is distinct from 'array'
      or jsonb_typeof(item.value -> 'warnings') is distinct from 'array'
      or exists (
        select 1 from jsonb_array_elements(item.value -> 'evidence') as evidence(value)
        where jsonb_typeof(evidence.value) <> 'object'
      )
      or exists (
        select 1 from jsonb_array_elements(item.value -> 'deductions') as deduction(value)
        where jsonb_typeof(deduction.value) <> 'object'
      )
      or exists (
        select 1 from jsonb_array_elements(item.value -> 'warnings') as warning(value)
        where jsonb_typeof(warning.value) <> 'string'
      ) then
      return false;
    end if;

    if item.value ->> 'status' = 'scored' then
      if item.value ->> 'availability' is distinct from 'available'
        or jsonb_typeof(item.value -> 'component') is distinct from 'number'
        or jsonb_typeof(item.value -> 'earned_points') is distinct from 'number' then
        return false;
      end if;
      component := (item.value ->> 'component')::numeric;
      earned := (item.value ->> 'earned_points')::numeric;
      if component < 0 or component > 1
        or earned <> round(component * expected_max) then
        return false;
      end if;
      scored_count := scored_count + 1;
      earned_sum := earned_sum + earned;
    elsif item.value ->> 'status' = 'not_checked' then
      if item.value ->> 'availability' is distinct from 'available'
        or jsonb_typeof(item.value -> 'component') is distinct from 'null'
        or jsonb_typeof(item.value -> 'earned_points') is distinct from 'null' then
        return false;
      end if;
    elsif item.value ->> 'status' = 'unavailable' then
      if item.value ->> 'availability' is distinct from 'unavailable'
        or jsonb_typeof(item.value -> 'component') is distinct from 'null'
        or jsonb_typeof(item.value -> 'earned_points') is distinct from 'null' then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;

  if category_count <> 6 then return false; end if;
  if scored_count = 6 then
    return jsonb_typeof(payload -> 'total_earned_points') = 'number'
      and attempt_score is not null
      and attempt_score between 0 and 100
      and (payload ->> 'total_earned_points')::numeric = attempt_score
      and earned_sum = attempt_score;
  end if;
  return not require_complete
    and jsonb_typeof(payload -> 'total_earned_points') = 'null'
    and attempt_score is null;
exception when others then
  return false;
end;
$$;

-- Every stored best must point to the same user's completed structured attempt.
-- A deleted attempt may clear the link without changing the durable best score.
create or replace function public.enforce_lesson_progress_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.lesson_id is distinct from old.lesson_id then
      raise exception 'lesson progress identity is immutable' using errcode = '23514';
    end if;
    if new.best_score < old.best_score then
      raise exception 'lesson best score cannot decrease' using errcode = '23514';
    end if;
    new.created_at = old.created_at;
    if new.best_score is distinct from old.best_score
      or new.best_attempt_id is distinct from old.best_attempt_id then
      new.updated_at = now();
    else
      new.updated_at = old.updated_at;
    end if;
  end if;

  if new.best_attempt_id is not null and not exists (
    select 1
    from public.attempts as attempt
    where attempt.id = new.best_attempt_id
      and attempt.user_id = new.user_id
      and attempt.lesson_id = new.lesson_id
      and attempt.status = 'done'
      and attempt.score = new.best_score
  ) then
    raise exception 'lesson best attempt must match its owner, lesson, and score'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger lesson_progress_enforce_integrity
  before insert or update on public.lesson_progress
  for each row execute function public.enforce_lesson_progress_integrity();

-- Only a complete, internally consistent current v2 structured result can
-- raise progress. Provider-incomplete results have a null total and are neutral.
create or replace function public.raise_lesson_progress_from_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lesson_id is null
    or new.status <> 'done'
    or new.rubric_version is distinct from 'v2'
    or not public.is_valid_v2_score_payload_for_attempt(
      new.section_scores,
      new.practice_mode,
      new.score,
      true
    ) then
    return new;
  end if;

  if not exists (
    select 1
    from public.practice_lessons as lesson
    join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
    join public.practice_paths as path on path.id = chapter.path_id
    where lesson.id = new.lesson_id
      and lesson.prompt_id = new.prompt_id
      and lesson.active and chapter.active and path.active
      and path.mode = new.practice_mode
  ) then
    return new;
  end if;

  insert into public.lesson_progress (user_id, lesson_id, best_score, best_attempt_id)
  values (new.user_id, new.lesson_id, new.score, new.id)
  on conflict (user_id, lesson_id) do update
  set best_score = excluded.best_score,
      best_attempt_id = excluded.best_attempt_id
  where excluded.best_score > lesson_progress.best_score
    or (
      excluded.best_score = lesson_progress.best_score
      and (
        lesson_progress.best_attempt_id is null
        or coalesce(
          (select attempt.finished_at from public.attempts as attempt
           where attempt.id = excluded.best_attempt_id),
          '-infinity'::timestamptz
        ) > coalesce(
          (select attempt.finished_at from public.attempts as attempt
           where attempt.id = lesson_progress.best_attempt_id),
          '-infinity'::timestamptz
        )
        or (
          coalesce(
            (select attempt.finished_at from public.attempts as attempt
             where attempt.id = excluded.best_attempt_id),
            '-infinity'::timestamptz
          ) = coalesce(
            (select attempt.finished_at from public.attempts as attempt
             where attempt.id = lesson_progress.best_attempt_id),
            '-infinity'::timestamptz
          )
          and excluded.best_attempt_id > lesson_progress.best_attempt_id
        )
      )
    );

  return new;
end;
$$;

create trigger attempts_raise_lesson_progress
  after insert or update of status, score, section_scores, practice_mode, prompt_id, lesson_id, rubric_version
  on public.attempts
  for each row execute function public.raise_lesson_progress_from_attempt();

alter table public.practice_paths enable row level security;
alter table public.practice_chapters enable row level security;
alter table public.practice_lessons enable row level security;
alter table public.profile_path_preferences enable row level security;
alter table public.lesson_progress enable row level security;

grant select on public.practice_paths, public.practice_chapters, public.practice_lessons
  to anon, authenticated;
grant select on public.profile_path_preferences, public.lesson_progress to authenticated;
grant select, insert, update, delete on
  public.practice_paths,
  public.practice_chapters,
  public.practice_lessons,
  public.profile_path_preferences,
  public.lesson_progress
  to service_role;

revoke insert, update, delete on public.profile_path_preferences from public, anon, authenticated;
revoke insert, update, delete on public.lesson_progress from public, anon, authenticated;
revoke all on function public.replace_profile_path_preferences(uuid[]) from public, anon;
grant execute on function public.replace_profile_path_preferences(uuid[])
  to authenticated, service_role;
revoke all on function public.raise_lesson_progress_from_attempt() from public, anon, authenticated;
revoke all on function public.is_valid_v2_score_payload_for_attempt(jsonb, text, integer, boolean)
  from public, anon, authenticated;
revoke all on function public.enforce_lesson_progress_integrity() from public, anon, authenticated;
revoke all on function public.enforce_practice_path_identity() from public, anon, authenticated;
revoke all on function public.enforce_practice_chapter_identity() from public, anon, authenticated;
revoke all on function public.enforce_practice_lesson_identity() from public, anon, authenticated;

create policy "practice_paths_select_all" on public.practice_paths
  for select to anon, authenticated using (true);
create policy "practice_chapters_select_all" on public.practice_chapters
  for select to anon, authenticated using (true);
create policy "practice_lessons_select_all" on public.practice_lessons
  for select to anon, authenticated using (true);
create policy "profile_path_preferences_select_own" on public.profile_path_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
-- These policies document the owner boundary even though authenticated direct
-- DML grants stay revoked. The atomic replacement function is the only browser
-- write surface and preserves a complete ranked set.
create policy "profile_path_preferences_insert_own" on public.profile_path_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profile_path_preferences_update_own" on public.profile_path_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "profile_path_preferences_delete_own" on public.profile_path_preferences
  for delete to authenticated using ((select auth.uid()) = user_id);
create policy "lesson_progress_select_own" on public.lesson_progress
  for select to authenticated using ((select auth.uid()) = user_id);
