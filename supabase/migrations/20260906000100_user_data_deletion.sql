-- User-owned deletion boundaries. Practice reset stays distinct from account
-- deletion: it removes derived speaking data while preserving the profile and
-- path preferences. Account deletion remains an Auth Admin operation so the
-- auth.users row and every audited ON DELETE CASCADE dependency disappear in
-- one database transaction.

-- Exact current activity validation. The score-null branch first validates
-- every non-scored metric's unavailable shape, then temporarily normalizes
-- those metrics into scored zeroes and delegates all shared deep validation
-- (maxima, component math, evidence, details, warnings, and recommendation)
-- to the canonical strict-current score validator.
create or replace function public.is_valid_current_activity_attempt(
  attempt_status text,
  attempt_duration_ms integer,
  attempt_transcript text,
  attempt_score integer,
  attempt_section_scores jsonb,
  attempt_mode text,
  attempt_rubric_version text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  section_item record;
  metric_item record;
  expected_metrics text[];
  actual_keys text[];
  expected_max integer;
  metric_rank integer;
  component numeric;
  earned numeric;
  section_sum integer;
  total_sum integer := 0;
  section_has_unavailable boolean;
  section_has_not_checked boolean;
  nonscored_metric_count integer := 0;
  strongest_component numeric;
  weakest_component numeric;
  strongest_rank integer;
  weakest_rank integer;
  strongest_metric text;
  weakest_metric text;
  strongest_explanation text;
  weakest_explanation text;
  validation_payload jsonb := attempt_section_scores;
  normalized_metric jsonb;
begin
  if attempt_status <> 'done'
    or attempt_rubric_version is distinct from 'v3'
    or attempt_duration_ms is null
    or attempt_duration_ms <= 0
    or nullif(btrim(attempt_transcript), '') is null
    or jsonb_typeof(attempt_section_scores) is distinct from 'object'
    or attempt_section_scores ->> 'version' is distinct from 'v3.score.2'
    or attempt_section_scores ->> 'rubric_version' is distinct from 'v3'
    or attempt_section_scores ->> 'mode' is distinct from attempt_mode
    or attempt_mode not in ('practice', 'interview', 'presentation', 'conversation') then
    return false;
  end if;

  if attempt_score is not null then
    return public.is_valid_current_score_payload_for_attempt(
      attempt_section_scores,
      attempt_mode,
      attempt_score
    );
  end if;

  select array_agg(key order by key)
  into actual_keys
  from jsonb_object_keys(attempt_section_scores) as keys(key);
  if actual_keys is distinct from array[
    'mode', 'recommendation', 'rubric_version', 'sections',
    'total_earned_points', 'total_max_points', 'version', 'warnings'
  ]::text[]
    or jsonb_typeof(attempt_section_scores -> 'total_earned_points') is distinct from 'null'
    or jsonb_typeof(attempt_section_scores -> 'total_max_points') is distinct from 'number'
    or (attempt_section_scores ->> 'total_max_points')::numeric <> 100
    or jsonb_typeof(attempt_section_scores -> 'recommendation') is distinct from 'null'
    or jsonb_typeof(attempt_section_scores -> 'warnings') is distinct from 'array'
    or exists (
      select 1
      from jsonb_array_elements(attempt_section_scores -> 'warnings') as warning(value)
      where jsonb_typeof(warning.value) <> 'string'
        or length(warning.value #>> '{}') > 1000
    )
    or jsonb_typeof(attempt_section_scores -> 'sections') is distinct from 'object' then
    return false;
  end if;

  select array_agg(key order by key)
  into actual_keys
  from jsonb_object_keys(attempt_section_scores -> 'sections') as keys(key);
  if actual_keys is distinct from array['how_you_sounded', 'what_you_said']::text[] then
    return false;
  end if;

  for section_item in
    select key, value from jsonb_each(attempt_section_scores -> 'sections')
  loop
    expected_metrics := case section_item.key
      when 'what_you_said' then array[
        'answered_prompt', 'specificity', 'structure',
        'conciseness', 'word_choice', 'grammar'
      ]::text[]
      when 'how_you_sounded' then array[
        'pace', 'paused_time', 'articulation', 'energy'
      ]::text[]
      else null
    end;
    if expected_metrics is null
      or jsonb_typeof(section_item.value) is distinct from 'object' then
      return false;
    end if;

    select array_agg(key order by key)
    into actual_keys
    from jsonb_object_keys(section_item.value) as keys(key);
    if actual_keys is distinct from array[
      'earned_points', 'max_points', 'metrics', 'section', 'status'
    ]::text[]
      or section_item.value ->> 'section' is distinct from section_item.key
      or section_item.value ->> 'status' not in ('scored', 'not_checked', 'unavailable')
      or jsonb_typeof(section_item.value -> 'max_points') is distinct from 'number'
      or (section_item.value ->> 'max_points')::numeric <> 50
      or jsonb_typeof(section_item.value -> 'metrics') is distinct from 'object' then
      return false;
    end if;

    select array_agg(key order by key)
    into actual_keys
    from jsonb_object_keys(section_item.value -> 'metrics') as keys(key);
    if actual_keys is distinct from (
      select array_agg(metric order by metric) from unnest(expected_metrics) as names(metric)
    ) then
      return false;
    end if;

    section_sum := 0;
    section_has_unavailable := false;
    section_has_not_checked := false;

    for metric_item in select key, value from jsonb_each(section_item.value -> 'metrics')
    loop
      expected_max := case attempt_mode
        when 'practice' then case metric_item.key
          when 'answered_prompt' then 10 when 'specificity' then 9
          when 'structure' then 9 when 'conciseness' then 8
          when 'word_choice' then 7 when 'grammar' then 7
          when 'pace' then 12 when 'paused_time' then 15
          when 'articulation' then 13 when 'energy' then 10
        end
        when 'interview' then case metric_item.key
          when 'answered_prompt' then 12 when 'specificity' then 11
          when 'structure' then 10 when 'conciseness' then 6
          when 'word_choice' then 6 when 'grammar' then 5
          when 'pace' then 10 when 'paused_time' then 15
          when 'articulation' then 15 when 'energy' then 10
        end
        when 'presentation' then case metric_item.key
          when 'answered_prompt' then 9 when 'specificity' then 9
          when 'structure' then 12 when 'conciseness' then 7
          when 'word_choice' then 7 when 'grammar' then 6
          when 'pace' then 12 when 'paused_time' then 12
          when 'articulation' then 11 when 'energy' then 15
        end
        when 'conversation' then case metric_item.key
          when 'answered_prompt' then 9 when 'specificity' then 8
          when 'structure' then 7 when 'conciseness' then 10
          when 'word_choice' then 8 when 'grammar' then 8
          when 'pace' then 11 when 'paused_time' then 14
          when 'articulation' then 15 when 'energy' then 10
        end
      end;
      metric_rank := case metric_item.key
        when 'answered_prompt' then 1 when 'specificity' then 2
        when 'structure' then 3 when 'conciseness' then 4
        when 'word_choice' then 5 when 'grammar' then 6
        when 'pace' then 7 when 'paused_time' then 8
        when 'articulation' then 9 when 'energy' then 10
      end;

      if expected_max is null
        or metric_rank is null
        or jsonb_typeof(metric_item.value) is distinct from 'object' then
        return false;
      end if;
      select array_agg(key order by key)
      into actual_keys
      from jsonb_object_keys(metric_item.value) as keys(key);
      if actual_keys is distinct from array[
        'component', 'details', 'earned_points', 'evidence', 'explanation',
        'max_points', 'measurements', 'metric', 'status', 'warnings'
      ]::text[]
        or metric_item.value ->> 'metric' is distinct from metric_item.key
        or jsonb_typeof(metric_item.value -> 'max_points') is distinct from 'number'
        or (metric_item.value ->> 'max_points')::numeric <> expected_max
        or jsonb_typeof(metric_item.value -> 'evidence') is distinct from 'array'
        or jsonb_typeof(metric_item.value -> 'details') is distinct from 'array'
        or jsonb_typeof(metric_item.value -> 'warnings') is distinct from 'array'
        or exists (
          select 1
          from jsonb_array_elements(metric_item.value -> 'warnings') as warning(value)
          where jsonb_typeof(warning.value) <> 'string'
            or length(warning.value #>> '{}') > 1000
        ) then
        return false;
      end if;

      if metric_item.value ->> 'status' = 'scored' then
        if jsonb_typeof(metric_item.value -> 'component') <> 'number'
          or jsonb_typeof(metric_item.value -> 'earned_points') <> 'number'
          or jsonb_typeof(metric_item.value -> 'explanation') <> 'string'
          or jsonb_typeof(metric_item.value -> 'measurements') not in ('object', 'null') then
          return false;
        end if;
        component := (metric_item.value ->> 'component')::numeric;
        earned := (metric_item.value ->> 'earned_points')::numeric;
      elsif metric_item.value ->> 'status' in ('not_checked', 'unavailable') then
        nonscored_metric_count := nonscored_metric_count + 1;
        section_has_not_checked := section_has_not_checked
          or metric_item.value ->> 'status' = 'not_checked';
        section_has_unavailable := section_has_unavailable
          or metric_item.value ->> 'status' = 'unavailable';
        if jsonb_typeof(metric_item.value -> 'component') <> 'null'
          or jsonb_typeof(metric_item.value -> 'earned_points') <> 'null'
          or jsonb_typeof(metric_item.value -> 'explanation') <> 'null'
          or jsonb_typeof(metric_item.value -> 'measurements') <> 'null'
          or jsonb_array_length(metric_item.value -> 'evidence') <> 0
          or jsonb_array_length(metric_item.value -> 'details') <> 0 then
          return false;
        end if;
        component := 0;
        earned := 0;
        normalized_metric := metric_item.value || jsonb_build_object(
          'status', 'scored',
          'component', component,
          'earned_points', earned,
          'explanation', 'Not scored.',
          'measurements', '{}'::jsonb,
          'warnings', '[]'::jsonb
        );
        validation_payload := jsonb_set(
          validation_payload,
          array['sections', section_item.key, 'metrics', metric_item.key],
          normalized_metric,
          false
        );
      else
        return false;
      end if;

      if component < 0 or component > 1
        or earned <> trunc(earned)
        or earned <> round(component * expected_max) then
        return false;
      end if;
      section_sum := section_sum + earned::integer;

      if strongest_component is null
        or component > strongest_component
        or (component = strongest_component and metric_rank < strongest_rank) then
        strongest_component := component;
        strongest_rank := metric_rank;
        strongest_metric := metric_item.key;
        strongest_explanation := case
          when metric_item.value ->> 'status' = 'scored'
            then metric_item.value ->> 'explanation'
          else 'Not scored.'
        end;
      end if;
      if weakest_component is null
        or component < weakest_component
        or (component = weakest_component and metric_rank > weakest_rank) then
        weakest_component := component;
        weakest_rank := metric_rank;
        weakest_metric := metric_item.key;
        weakest_explanation := case
          when metric_item.value ->> 'status' = 'scored'
            then metric_item.value ->> 'explanation'
          else 'Not scored.'
        end;
      end if;
    end loop;

    if section_has_unavailable then
      if section_item.value ->> 'status' <> 'unavailable'
        or jsonb_typeof(section_item.value -> 'earned_points') <> 'null' then return false; end if;
    elsif section_has_not_checked then
      if section_item.value ->> 'status' <> 'not_checked'
        or jsonb_typeof(section_item.value -> 'earned_points') <> 'null' then return false; end if;
    elsif section_item.value ->> 'status' <> 'scored'
      or jsonb_typeof(section_item.value -> 'earned_points') <> 'number'
      or (section_item.value ->> 'earned_points')::numeric <> section_sum then
      return false;
    end if;

    validation_payload := jsonb_set(
      validation_payload,
      array['sections', section_item.key, 'status'],
      '"scored"'::jsonb,
      false
    );
    validation_payload := jsonb_set(
      validation_payload,
      array['sections', section_item.key, 'earned_points'],
      to_jsonb(section_sum),
      false
    );
    total_sum := total_sum + section_sum;
  end loop;

  if nonscored_metric_count = 0 then return false; end if;
  validation_payload := jsonb_set(
    validation_payload,
    array['total_earned_points'],
    to_jsonb(total_sum),
    false
  );
  validation_payload := jsonb_set(
    validation_payload,
    array['recommendation'],
    jsonb_build_object(
      'strongest_metric', strongest_metric,
      'weakest_metric', weakest_metric,
      'text', case
        when strongest_metric = weakest_metric then strongest_explanation
        else strongest_explanation || ' ' || weakest_explanation
      end
    ),
    false
  );

  return public.is_valid_current_score_payload_for_attempt(
    validation_payload,
    attempt_mode,
    total_sum
  );
exception when others then
  return false;
end;
$$;

-- Every attempt mutation shares the user deletion lock. A concurrent write
-- therefore lands wholly before a reset/delete and is removed, or wholly
-- afterward as genuinely new practice data. Attempt ownership is immutable.
do $$
begin
  if exists (
    select 1
    from public.attempts as retry
    join public.attempts as parent on parent.id = retry.retry_of_attempt_id
    where retry.user_id <> parent.user_id
  ) then
    raise exception 'cross-user retry relationships must be repaired before deletion migration'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.lock_attempt_owner_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'attempt ownership is immutable' using errcode = '23514';
  end if;

  owner_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text, 0)
  );
  if tg_op <> 'DELETE'
    and new.retry_of_attempt_id is not null
    and not exists (
      select 1
      from public.attempts as parent
      where parent.id = new.retry_of_attempt_id
        and parent.user_id = new.user_id
    ) then
    raise exception 'retry parent must belong to the attempt owner'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists attempts_lock_owner_mutation on public.attempts;
create trigger attempts_lock_owner_mutation
  before insert or update or delete on public.attempts
  for each row execute function public.lock_attempt_owner_mutation();

-- Storage authorization participates in the same owner lock as attempt reset
-- and deletion. An upload that starts first commits before cleanup inventory;
-- a reset that starts first removes the attempt before this check can pass.
create or replace function public.can_write_owned_recording(target_name text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null or target_name is null then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text, 0)
  );

  return split_part(target_name, '/', 1) = owner_id::text
    and exists (
      select 1
      from public.attempts as attempt
      where attempt.user_id = owner_id
        and attempt.status = 'uploading'
        and attempt.metrics #>> '{upload,storage_path}' = target_name
    );
end;
$$;

drop policy if exists "recordings_insert_own" on storage.objects;
create policy "recordings_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and public.can_write_owned_recording(name)
  );

drop policy if exists "recordings_update_own" on storage.objects;
create policy "recordings_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'recordings'
    and public.can_write_owned_recording(name)
  )
  with check (
    bucket_id = 'recordings'
    and public.can_write_owned_recording(name)
  );

create or replace function public.rebuild_owned_lesson_progress(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  lesson_record record;
begin
  delete from public.lesson_progress where user_id = target_user_id;

  for lesson_record in
    with ordered_lessons as (
      select
        path.id as path_id,
        path.position as path_position,
        chapter.position as chapter_position,
        lesson.position as lesson_position,
        lesson.id as lesson_id,
        lag(lesson.id) over (
          partition by path.id order by chapter.position, lesson.position
        ) as previous_lesson_id
      from public.practice_paths as path
      join public.practice_chapters as chapter on chapter.path_id = path.id
      join public.practice_lessons as lesson on lesson.chapter_id = chapter.id
      join public.prompts as prompt on prompt.id = lesson.prompt_id
      where path.active and chapter.active and lesson.active and prompt.active
        and prompt.mode = path.mode
        and prompt.difficulty = chapter.level
    )
    select * from ordered_lessons
    order by path_position, chapter_position, lesson_position
  loop
    insert into public.lesson_progress (
      user_id,
      lesson_id,
      best_score,
      best_attempt_id,
      created_at,
      updated_at
    )
    select
      target_user_id,
      lesson_record.lesson_id,
      candidate.score,
      candidate.id,
      coalesce(candidate.finished_at, candidate.created_at, now()),
      coalesce(candidate.finished_at, candidate.created_at, now())
    from (
      select
        attempt.id,
        attempt.score,
        attempt.finished_at,
        attempt.created_at
      from public.attempts as attempt
      join public.practice_lessons as lesson on lesson.id = attempt.lesson_id
      join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
      join public.practice_paths as path on path.id = chapter.path_id
      join public.prompts as prompt on prompt.id = lesson.prompt_id
      where attempt.user_id = target_user_id
        and attempt.lesson_id = lesson_record.lesson_id
        and attempt.prompt_id = lesson.prompt_id
        and attempt.prompt_id = prompt.id
        and attempt.status = 'done'
        and attempt.rubric_version = 'v3'
        and attempt.practice_mode = path.mode
        and attempt.prompt_source = 'library'
        and attempt.prompt_difficulty = chapter.level
        and lesson.active and chapter.active and path.active and prompt.active
        and prompt.mode = path.mode
        and prompt.difficulty = chapter.level
        and public.is_valid_current_score_payload_for_attempt(
          attempt.section_scores,
          attempt.practice_mode,
          attempt.score
        )
        and (
          lesson_record.previous_lesson_id is null
          or exists (
            select 1
            from public.lesson_progress as progress
            where progress.user_id = target_user_id
              and progress.lesson_id = lesson_record.previous_lesson_id
              and progress.best_score >= 70
          )
        )
      order by attempt.score desc, attempt.finished_at desc nulls last, attempt.id desc
      limit 1
    ) as candidate;
  end loop;
end;
$$;

-- A new prerequisite pass may make preserved downstream attempts legitimate
-- again. Rebuild the whole user's durable chain after every valid current
-- structured result instead of incrementally raising only the changed lesson.
create or replace function public.raise_lesson_progress_from_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lesson_id is not null
    and new.status = 'done'
    and new.rubric_version = 'v3'
    and public.is_valid_current_score_payload_for_attempt(
      new.section_scores,
      new.practice_mode,
      new.score
    ) then
    perform public.rebuild_owned_lesson_progress(new.user_id);
  end if;
  return new;
end;
$$;

create or replace function public.record_practice_activity_for_attempt(
  target_user_id uuid,
  target_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_record record;
  owner_timezone text;
begin
  if target_user_id is null or target_attempt_id is null then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_user_id::text, 0)
  );

  select
    attempt.status,
    attempt.duration_ms,
    attempt.transcript,
    attempt.score,
    attempt.section_scores,
    attempt.practice_mode,
    attempt.rubric_version,
    coalesce(attempt.finished_at, attempt.created_at) as completed_at
  into attempt_record
  from public.attempts as attempt
  where attempt.id = target_attempt_id
    and attempt.user_id = target_user_id;

  if not found or not public.is_valid_current_activity_attempt(
    attempt_record.status,
    attempt_record.duration_ms,
    attempt_record.transcript,
    attempt_record.score,
    attempt_record.section_scores,
    attempt_record.practice_mode,
    attempt_record.rubric_version
  ) then
    return false;
  end if;

  select coalesce(profile.timezone, 'UTC')
  into owner_timezone
  from public.profiles as profile
  where profile.id = target_user_id;
  owner_timezone := coalesce(owner_timezone, 'UTC');

  insert into public.practice_activity_days (user_id, local_date, timezone)
  values (
    target_user_id,
    (attempt_record.completed_at at time zone owner_timezone)::date,
    owner_timezone
  )
  on conflict (user_id, local_date) do nothing;

  return true;
end;
$$;

create or replace function public.delete_owned_attempt_and_rebuild(
  target_user_id uuid,
  target_attempt_id uuid
)
returns table (
  deleted boolean,
  lesson_id uuid,
  best_attempt_id uuid,
  path_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_lesson_id uuid;
  deleted_completed_at timestamptz;
  deleted_path_slug text;
  surviving_best_attempt_id uuid;
  activity_record record;
begin
  if target_user_id is null or target_attempt_id is null then
    return query select false, null::uuid, null::uuid, null::text;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_user_id::text, 0)
  );

  select attempt.lesson_id, coalesce(attempt.finished_at, attempt.created_at), path.slug
  into deleted_lesson_id, deleted_completed_at, deleted_path_slug
  from public.attempts as attempt
  left join public.practice_lessons as lesson on lesson.id = attempt.lesson_id
  left join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
  left join public.practice_paths as path on path.id = chapter.path_id
  where attempt.id = target_attempt_id
    and attempt.user_id = target_user_id
    and attempt.status in ('done', 'failed', 'timed_out')
  for update of attempt;

  if not found then
    return query select false, null::uuid, null::uuid, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.attempts as retry
    where retry.retry_of_attempt_id = target_attempt_id
      and retry.user_id <> target_user_id
  ) then
    raise exception 'cross-user retry relationship blocks deletion'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.note_feedback as feedback
    where feedback.attempt_id = target_attempt_id
      and feedback.user_id <> target_user_id
  ) then
    raise exception 'cross-user feedback relationship blocks deletion'
      using errcode = '23514';
  end if;

  delete from public.attempts
  where id = target_attempt_id and user_id = target_user_id;

  perform public.rebuild_owned_lesson_progress(target_user_id);

  -- Only reconsider activity rows whose own stored timezone maps the deleted
  -- response onto that local day. This preserves historical days recorded
  -- before a profile timezone change.
  for activity_record in
    select activity.local_date, activity.timezone
    from public.practice_activity_days as activity
    where activity.user_id = target_user_id
      and activity.local_date = (deleted_completed_at at time zone activity.timezone)::date
  loop
    if not exists (
      select 1
      from public.attempts as attempt
      where attempt.user_id = target_user_id
        and public.is_valid_current_activity_attempt(
          attempt.status,
          attempt.duration_ms,
          attempt.transcript,
          attempt.score,
          attempt.section_scores,
          attempt.practice_mode,
          attempt.rubric_version
        )
        and (coalesce(attempt.finished_at, attempt.created_at)
          at time zone activity_record.timezone)::date = activity_record.local_date
    ) then
      delete from public.practice_activity_days
      where user_id = target_user_id
        and local_date = activity_record.local_date;
    end if;
  end loop;

  if deleted_lesson_id is not null then
    select attempt.id
    into surviving_best_attempt_id
    from public.attempts as attempt
    join public.practice_lessons as lesson on lesson.id = attempt.lesson_id
    join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
    join public.practice_paths as path on path.id = chapter.path_id
    join public.prompts as prompt on prompt.id = lesson.prompt_id
    where attempt.user_id = target_user_id
      and attempt.lesson_id = deleted_lesson_id
      and attempt.prompt_id = lesson.prompt_id
      and attempt.status = 'done'
      and attempt.rubric_version = 'v3'
      and attempt.practice_mode = path.mode
      and attempt.prompt_source = 'library'
      and attempt.prompt_difficulty = chapter.level
      and lesson.active and chapter.active and path.active and prompt.active
      and prompt.mode = path.mode
      and prompt.difficulty = chapter.level
      and public.is_valid_current_score_payload_for_attempt(
        attempt.section_scores,
        attempt.practice_mode,
        attempt.score
      )
    order by attempt.score desc, attempt.finished_at desc nulls last, attempt.id desc
    limit 1;

    -- If no scored survivor exists, keep the user on the best available
    -- terminal result instead of discarding a preserved neutral or failure.
    if surviving_best_attempt_id is null then
      select attempt.id
      into surviving_best_attempt_id
      from public.attempts as attempt
      where attempt.user_id = target_user_id
        and attempt.lesson_id = deleted_lesson_id
        and attempt.rubric_version = 'v3'
        and attempt.status in ('done', 'failed', 'timed_out')
        and (
          attempt.status <> 'done'
          or public.is_valid_current_activity_attempt(
            attempt.status,
            attempt.duration_ms,
            attempt.transcript,
            attempt.score,
            attempt.section_scores,
            attempt.practice_mode,
            attempt.rubric_version
          )
        )
      order by
        case attempt.status when 'done' then 0 when 'failed' then 1 else 2 end,
        attempt.finished_at desc nulls last,
        attempt.id desc
      limit 1;
    end if;
  end if;

  return query
  select true, deleted_lesson_id, surviving_best_attempt_id, deleted_path_slug;
end;
$$;

create or replace function public.assert_my_data_deletion_safe()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.attempts as retry
    join public.attempts as parent on parent.id = retry.retry_of_attempt_id
    where parent.user_id = owner_id
      and retry.user_id <> owner_id
  ) then
    raise exception 'cross-user retry relationship blocks deletion'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.note_feedback as feedback
    join public.attempts as attempt on attempt.id = feedback.attempt_id
    where attempt.user_id = owner_id
      and feedback.user_id <> owner_id
  ) then
    raise exception 'cross-user feedback relationship blocks deletion'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.reset_my_progress()
returns table (
  attempts_deleted bigint,
  lesson_progress_deleted bigint,
  activity_days_deleted bigint,
  recording_claims jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text, 0)
  );

  if exists (
    select 1
    from public.attempts as retry
    join public.attempts as parent on parent.id = retry.retry_of_attempt_id
    where parent.user_id = owner_id
      and retry.user_id <> owner_id
  ) then
    raise exception 'cross-user retry relationship blocks deletion'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.note_feedback as feedback
    join public.attempts as attempt on attempt.id = feedback.attempt_id
    where attempt.user_id = owner_id
      and feedback.user_id <> owner_id
  ) then
    raise exception 'cross-user feedback relationship blocks deletion'
      using errcode = '23514';
  end if;

  select count(*) into lesson_progress_deleted
  from public.lesson_progress where user_id = owner_id;
  select count(*) into activity_days_deleted
  from public.practice_activity_days where user_id = owner_id;
  select count(*) into attempts_deleted
  from public.attempts where user_id = owner_id;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', attempt.id,
        'audio_path', attempt.audio_path,
        'metrics', attempt.metrics
      ) order by attempt.id
    ),
    '[]'::jsonb
  )
  into recording_claims
  from public.attempts as attempt
  where attempt.user_id = owner_id;

  delete from public.lesson_progress where user_id = owner_id;
  delete from public.practice_activity_days where user_id = owner_id;
  -- Attempt deletion cascades exact attempt feedback and clears retry parents.
  delete from public.attempts where user_id = owner_id;

  return next;
end;
$$;

revoke all privileges on function public.is_valid_current_activity_attempt(
  text, integer, text, integer, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all privileges on function public.lock_attempt_owner_mutation()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.can_write_owned_recording(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.rebuild_owned_lesson_progress(uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.record_practice_activity_for_attempt(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.delete_owned_attempt_and_rebuild(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.assert_my_data_deletion_safe()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.reset_my_progress()
  from public, anon, authenticated, service_role;

grant execute on function public.is_valid_current_activity_attempt(
  text, integer, text, integer, jsonb, text, text
) to service_role;
grant execute on function public.lock_attempt_owner_mutation() to service_role;
grant execute on function public.can_write_owned_recording(text) to authenticated, service_role;
grant execute on function public.rebuild_owned_lesson_progress(uuid) to service_role;
grant execute on function public.record_practice_activity_for_attempt(uuid, uuid) to service_role;
grant execute on function public.delete_owned_attempt_and_rebuild(uuid, uuid) to service_role;
grant execute on function public.assert_my_data_deletion_safe() to authenticated, service_role;
grant execute on function public.reset_my_progress() to authenticated, service_role;
