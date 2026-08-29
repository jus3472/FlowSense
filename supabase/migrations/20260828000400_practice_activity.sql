-- Durable speaking activity and profile timezone support.
-- Historical timezones were not stored, so the conservative backfill uses UTC.

create or replace function public.is_valid_iana_timezone(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select candidate is not null
    and length(candidate) between 1 and 100
    and candidate ~ '^[A-Za-z0-9_+/-]+$'
    and exists (
      select 1
      from pg_catalog.pg_timezone_names as zone
      where zone.name = candidate
    );
$$;

alter table public.profiles
  add column timezone text;

alter table public.profiles
  add constraint profiles_timezone_iana_check
  check (timezone is null or public.is_valid_iana_timezone(timezone));

create table public.practice_activity_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, local_date),
  constraint practice_activity_days_timezone_iana_check
    check (public.is_valid_iana_timezone(timezone))
);

create index practice_activity_days_user_date_desc_idx
  on public.practice_activity_days (user_id, local_date desc);

-- This migration-only validator mirrors the application's supported result
-- boundary conservatively. It deliberately rejects uncertain historical rows.
create function public.phase5_qualifies_practice_activity(
  attempt_status text,
  attempt_duration_ms integer,
  attempt_transcript text,
  attempt_score integer,
  attempt_section_scores jsonb,
  attempt_mode text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  expected_keys text[];
begin
  if attempt_status <> 'done'
    or attempt_duration_ms is null
    or attempt_duration_ms <= 0
    or nullif(btrim(attempt_transcript), '') is null
    or jsonb_typeof(attempt_section_scores) <> 'object' then
    return false;
  end if;

  if attempt_section_scores ?| array[
    'version', 'rubric_version', 'mode', 'total_earned_points',
    'total_max_points', 'categories'
  ] then
    return public.is_valid_v2_score_payload_for_attempt(
      attempt_section_scores,
      attempt_mode,
      attempt_score,
      false
    );
  end if;

  if attempt_score is null or attempt_score not between 0 and 100
    or jsonb_typeof(attempt_section_scores -> 'content') <> 'object'
    or jsonb_typeof(attempt_section_scores -> 'delivery') <> 'object'
    or jsonb_typeof(attempt_section_scores -> 'content' -> 'earned') <> 'number'
    or jsonb_typeof(attempt_section_scores -> 'content' -> 'max') <> 'number'
    or jsonb_typeof(attempt_section_scores -> 'content' -> 'checks') <> 'object'
    or jsonb_typeof(attempt_section_scores -> 'delivery' -> 'earned') <> 'number'
    or jsonb_typeof(attempt_section_scores -> 'delivery' -> 'max') <> 'number'
    or jsonb_typeof(attempt_section_scores -> 'delivery' -> 'metrics') <> 'object' then
    return false;
  end if;

  expected_keys := array['answered', 'explained', 'word_choice', 'logical_order', 'no_repetition'];
  if (select array_agg(key order by key) from jsonb_object_keys(
    attempt_section_scores -> 'content' -> 'checks'
  ) as keys(key)) is distinct from (select array_agg(key order by key) from unnest(expected_keys) as keys(key)) then
    return false;
  end if;
  expected_keys := array['fillers', 'mid_sentence_pauses', 'energy', 'pace', 'time_to_first_word'];
  if (select array_agg(key order by key) from jsonb_object_keys(
    attempt_section_scores -> 'delivery' -> 'metrics'
  ) as keys(key)) is distinct from (select array_agg(key order by key) from unnest(expected_keys) as keys(key)) then
    return false;
  end if;
  if exists (
    select 1 from jsonb_each(attempt_section_scores -> 'content' -> 'checks')
    where jsonb_typeof(value) <> 'number'
  ) or exists (
    select 1 from jsonb_each(attempt_section_scores -> 'delivery' -> 'metrics')
    where jsonb_typeof(value) <> 'number'
  ) then
    return false;
  end if;

  return (attempt_section_scores -> 'content' ->> 'earned')::numeric
      + (attempt_section_scores -> 'delivery' ->> 'earned')::numeric = attempt_score;
exception when others then
  return false;
end;
$$;

insert into public.practice_activity_days (user_id, local_date, timezone, created_at)
select
  attempt.user_id,
  (coalesce(attempt.finished_at, attempt.created_at) at time zone 'UTC')::date,
  'UTC',
  min(coalesce(attempt.finished_at, attempt.created_at))
from public.attempts as attempt
where public.phase5_qualifies_practice_activity(
  attempt.status::text,
  attempt.duration_ms,
  attempt.transcript,
  attempt.score,
  attempt.section_scores,
  attempt.practice_mode
)
group by
  attempt.user_id,
  (coalesce(attempt.finished_at, attempt.created_at) at time zone 'UTC')::date
on conflict (user_id, local_date) do nothing;

drop function public.phase5_qualifies_practice_activity(text, integer, text, integer, jsonb, text);

alter table public.practice_activity_days enable row level security;

grant select on public.practice_activity_days to authenticated;
grant select, insert on public.practice_activity_days to service_role;
revoke insert, update, delete on public.practice_activity_days from public, anon, authenticated;

revoke all on function public.is_valid_iana_timezone(text) from public, anon;
grant execute on function public.is_valid_iana_timezone(text) to authenticated, service_role;

create policy "practice_activity_days_select_own" on public.practice_activity_days
  for select to authenticated using ((select auth.uid()) = user_id);
