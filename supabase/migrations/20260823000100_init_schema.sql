-- FlowSense core schema.
--
-- Scoring payloads are jsonb rather than one column per measurement. The score
-- model changes repeatedly during tuning and none of those changes should need
-- a migration.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  focus_areas text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create table if not exists public.prompts (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt_id uuid references public.prompts (id) on delete set null,
  -- Denormalized on purpose: editing a prompt must never change a past result.
  prompt_text text not null,
  audio_path text,
  transcript text,
  duration_ms integer,
  score integer,
  section_scores jsonb,
  metrics jsonb,
  content_result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.note_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  note_type text not null,
  quote text,
  created_at timestamptz not null default now()
);

create index if not exists attempts_user_created_idx
  on public.attempts (user_id, created_at desc);
create index if not exists note_feedback_user_idx on public.note_feedback (user_id);
create index if not exists note_feedback_attempt_idx on public.note_feedback (attempt_id);
create index if not exists prompts_active_idx on public.prompts (active) where active;

-- Every new auth user gets a profile row, so the app never has to create one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
