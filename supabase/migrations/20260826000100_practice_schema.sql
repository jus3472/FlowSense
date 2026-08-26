-- Practice library metadata and attempt snapshots. Existing prompt and attempt
-- rows receive safe prompt defaults, while nullable attempt columns preserve
-- legacy history and allow custom prompts without a public prompt row.

alter table public.prompts
  add column if not exists mode text not null default 'practice'
    check (mode in ('practice', 'interview', 'presentation', 'conversation')),
  add column if not exists difficulty text not null default 'beginner'
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  add column if not exists target_duration_seconds integer not null default 60
    check (target_duration_seconds between 15 and 600),
  -- A stable slug for grouping library prompts without coupling them to display copy.
  add column if not exists collection_id text
    check (collection_id is null or collection_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

alter table public.attempts
  add column if not exists practice_mode text
    check (practice_mode is null or practice_mode in ('practice', 'interview', 'presentation', 'conversation')),
  add column if not exists prompt_source text
    check (prompt_source is null or prompt_source in ('library', 'custom')),
  add column if not exists prompt_difficulty text
    check (prompt_difficulty is null or prompt_difficulty in ('beginner', 'intermediate', 'advanced')),
  add column if not exists rubric_version text,
  -- Preserve a retry's history if its source and audio are deleted.
  add column if not exists retry_of_attempt_id uuid
    references public.attempts (id) on delete set null,
  add constraint attempts_retry_not_self_check
    check (retry_of_attempt_id is null or retry_of_attempt_id <> id);

-- RLS already applies to these tables and continues to govern the new columns.
-- These indexes support scoped history filters and parent-to-retry lookups.
create index if not exists attempts_user_practice_mode_created_idx
  on public.attempts (user_id, practice_mode, created_at desc)
  where practice_mode is not null;

create index if not exists attempts_retry_of_attempt_idx
  on public.attempts (retry_of_attempt_id)
  where retry_of_attempt_id is not null;
