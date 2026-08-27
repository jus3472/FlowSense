-- Durable attempt processing state, server-owned mutations, and profile repair.
-- Existing result snapshots remain authoritative. A stored score or result
-- payload means the historical attempt completed, including a partial v2
-- result whose overall score is null. Rows without any result snapshot cannot
-- be proven complete and are closed as timed out instead of being presented as
-- completed work.

alter table public.attempts
  add column status text,
  add column status_changed_at timestamptz,
  add column finished_at timestamptz,
  add column failure_code text,
  -- Nullable for historical rows. New server orchestration supplies a UUID so
  -- repeated create requests resolve to one logical recording per user.
  add column client_request_id uuid;

update public.attempts
set
  status = case
    when score is not null
      or section_scores is not null
      or content_result is not null
      then 'done'
    else 'timed_out'
  end,
  status_changed_at = created_at,
  finished_at = created_at,
  failure_code = case
    when score is not null
      or section_scores is not null
      or content_result is not null
      then null
    else 'legacy_incomplete'
  end;

alter table public.attempts
  alter column status set default 'uploading',
  alter column status set not null,
  alter column status_changed_at set default now(),
  alter column status_changed_at set not null,
  add constraint attempts_status_check
    check (status in ('uploading', 'transcribing', 'scoring', 'done', 'failed', 'timed_out')),
  add constraint attempts_failure_code_check
    check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  add constraint attempts_status_metadata_check
    check (
      (
        status in ('uploading', 'transcribing', 'scoring')
        and finished_at is null
        and failure_code is null
      )
      or (status = 'done' and finished_at is not null and failure_code is null)
      or (status in ('failed', 'timed_out') and finished_at is not null)
    );

create unique index attempts_user_client_request_idx
  on public.attempts (user_id, client_request_id)
  where client_request_id is not null;

create index attempts_user_status_created_idx
  on public.attempts (user_id, status, created_at desc);

create or replace function public.enforce_attempt_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'uploading' and new.status in ('transcribing', 'failed', 'timed_out'))
      or (old.status = 'transcribing' and new.status in ('scoring', 'failed', 'timed_out'))
      or (old.status = 'scoring' and new.status in ('done', 'failed', 'timed_out'))
      or (old.status in ('failed', 'timed_out') and new.status in ('transcribing', 'scoring'))
    ) then
      raise exception 'invalid attempt status transition from % to %', old.status, new.status
        using errcode = '23514';
    end if;

    new.status_changed_at = now();
    if new.status in ('done', 'failed', 'timed_out') then
      new.finished_at = coalesce(new.finished_at, now());
    else
      new.finished_at = null;
      new.failure_code = null;
    end if;
  end if;

  if new.status = 'done' then
    new.failure_code = null;
  end if;

  return new;
end;
$$;

create trigger attempts_enforce_status_transition
  before update of status on public.attempts
  for each row execute function public.enforce_attempt_status_transition();

-- Browser sessions may read their own attempts but may no longer create,
-- rewrite, or delete authoritative capture and scoring records directly.
revoke insert, update, delete on public.attempts from public;
revoke insert, update, delete on public.attempts from anon;
revoke insert, update, delete on public.attempts from authenticated;
grant select on public.attempts to authenticated;
grant select, insert, update, delete on public.attempts to service_role;

drop policy if exists "attempts_insert_own" on public.attempts;
drop policy if exists "attempts_update_own" on public.attempts;
drop policy if exists "attempts_delete_own" on public.attempts;

-- The signup trigger covers future users. This insert repairs users that
-- existed before the trigger without changing any existing profile fields.
insert into public.profiles (id, display_name)
select auth_user.id, nullif(auth_user.raw_user_meta_data ->> 'display_name', '')
from auth.users as auth_user
left join public.profiles as profile on profile.id = auth_user.id
where profile.id is null
on conflict (id) do nothing;
