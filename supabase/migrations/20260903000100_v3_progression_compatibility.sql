-- Add the immutable v3.score.1 progression boundary without changing stored
-- v2 attempts or lesson bests. Only exact, complete payloads can raise progress.

create or replace function public.is_valid_v3_score_payload_for_attempt(
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
  section_item record;
  metric_item record;
  expected_metrics text[];
  actual_keys text[];
  expected_max integer;
  metric_count integer := 0;
  section_count integer := 0;
  section_metric_count integer;
  section_scored_count integer;
  section_unavailable_count integer;
  section_max_sum integer;
  section_earned_sum numeric;
  total_earned_sum numeric := 0;
  component numeric;
  earned numeric;
  expected_section_status text;
  all_sections_scored boolean := true;
begin
  if require_complete is null
    or jsonb_typeof(payload) is distinct from 'object'
    or payload ->> 'version' is distinct from 'v3.score.1'
    or payload ->> 'rubric_version' is distinct from 'v3'
    or payload ->> 'mode' is distinct from attempt_mode
    or attempt_mode not in ('practice', 'interview', 'presentation', 'conversation')
    or jsonb_typeof(payload -> 'total_max_points') is distinct from 'number'
    or (payload ->> 'total_max_points')::numeric <> 100
    or jsonb_typeof(payload -> 'sections') is distinct from 'object'
    or jsonb_typeof(payload -> 'warnings') is distinct from 'array'
    or exists (
      select 1 from jsonb_array_elements(payload -> 'warnings') as warning(value)
      where jsonb_typeof(warning.value) <> 'string'
    ) then
    return false;
  end if;

  select array_agg(key order by key)
  into actual_keys
  from jsonb_object_keys(payload) as keys(key);
  if actual_keys is distinct from array[
    'mode', 'recommendation', 'rubric_version', 'sections',
    'total_earned_points', 'total_max_points', 'version', 'warnings'
  ]::text[] then
    return false;
  end if;

  select array_agg(key order by key)
  into actual_keys
  from jsonb_object_keys(payload -> 'sections') as keys(key);
  if actual_keys is distinct from array['how_you_sounded', 'what_you_said']::text[] then
    return false;
  end if;

  for section_item in select key, value from jsonb_each(payload -> 'sections')
  loop
    section_count := section_count + 1;
    if section_item.key = 'what_you_said' then
      expected_metrics := array[
        'answered_prompt', 'specificity', 'structure',
        'conciseness', 'word_choice', 'grammar'
      ]::text[];
    elsif section_item.key = 'how_you_sounded' then
      expected_metrics := array[
        'pace', 'time_to_first_word', 'paused_time', 'articulation', 'energy'
      ]::text[];
    else
      return false;
    end if;

    if jsonb_typeof(section_item.value) is distinct from 'object' then
      return false;
    end if;
    select array_agg(key order by key)
    into actual_keys
    from jsonb_object_keys(section_item.value) as keys(key);
    if actual_keys is distinct from array[
      'earned_points', 'max_points', 'metrics', 'section', 'status'
    ]::text[]
      or section_item.value ->> 'section' is distinct from section_item.key
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

    section_metric_count := 0;
    section_scored_count := 0;
    section_unavailable_count := 0;
    section_max_sum := 0;
    section_earned_sum := 0;

    for metric_item in select key, value from jsonb_each(section_item.value -> 'metrics')
    loop
      section_metric_count := section_metric_count + 1;
      metric_count := metric_count + 1;
      expected_max := case attempt_mode
        when 'practice' then case metric_item.key
          when 'answered_prompt' then 10 when 'specificity' then 9
          when 'structure' then 9 when 'conciseness' then 8
          when 'word_choice' then 7 when 'grammar' then 7
          when 'pace' then 12 when 'time_to_first_word' then 5
          when 'paused_time' then 10 when 'articulation' then 13 when 'energy' then 10
        end
        when 'interview' then case metric_item.key
          when 'answered_prompt' then 12 when 'specificity' then 11
          when 'structure' then 10 when 'conciseness' then 6
          when 'word_choice' then 6 when 'grammar' then 5
          when 'pace' then 10 when 'time_to_first_word' then 6
          when 'paused_time' then 9 when 'articulation' then 15 when 'energy' then 10
        end
        when 'presentation' then case metric_item.key
          when 'answered_prompt' then 9 when 'specificity' then 9
          when 'structure' then 12 when 'conciseness' then 7
          when 'word_choice' then 7 when 'grammar' then 6
          when 'pace' then 12 when 'time_to_first_word' then 3
          when 'paused_time' then 9 when 'articulation' then 11 when 'energy' then 15
        end
        when 'conversation' then case metric_item.key
          when 'answered_prompt' then 9 when 'specificity' then 8
          when 'structure' then 7 when 'conciseness' then 10
          when 'word_choice' then 8 when 'grammar' then 8
          when 'pace' then 11 when 'time_to_first_word' then 4
          when 'paused_time' then 10 when 'articulation' then 15 when 'energy' then 10
        end
      end;

      if expected_max is null
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
          select 1 from jsonb_array_elements(metric_item.value -> 'evidence') as evidence(value)
          where jsonb_typeof(evidence.value) <> 'object'
        )
        or exists (
          select 1 from jsonb_array_elements(metric_item.value -> 'details') as detail(value)
          where jsonb_typeof(detail.value) <> 'object'
        )
        or exists (
          select 1 from jsonb_array_elements(metric_item.value -> 'warnings') as warning(value)
          where jsonb_typeof(warning.value) <> 'string'
        ) then
        return false;
      end if;

      section_max_sum := section_max_sum + expected_max;
      if metric_item.value ->> 'status' = 'scored' then
        if jsonb_typeof(metric_item.value -> 'component') is distinct from 'number'
          or jsonb_typeof(metric_item.value -> 'earned_points') is distinct from 'number'
          or jsonb_typeof(metric_item.value -> 'explanation') is distinct from 'string'
          or nullif(btrim(metric_item.value ->> 'explanation'), '') is null
          or jsonb_typeof(metric_item.value -> 'measurements') not in ('object', 'null') then
          return false;
        end if;
        component := (metric_item.value ->> 'component')::numeric;
        earned := (metric_item.value ->> 'earned_points')::numeric;
        if component < 0 or component > 1
          or earned <> trunc(earned)
          or earned < 0 or earned > expected_max
          or earned <> round(component * expected_max) then
          return false;
        end if;
        section_scored_count := section_scored_count + 1;
        section_earned_sum := section_earned_sum + earned;
      elsif metric_item.value ->> 'status' in ('not_checked', 'unavailable') then
        if jsonb_typeof(metric_item.value -> 'component') is distinct from 'null'
          or jsonb_typeof(metric_item.value -> 'earned_points') is distinct from 'null'
          or jsonb_typeof(metric_item.value -> 'explanation') is distinct from 'null'
          or jsonb_typeof(metric_item.value -> 'measurements') is distinct from 'null'
          or jsonb_array_length(metric_item.value -> 'evidence') <> 0
          or jsonb_array_length(metric_item.value -> 'details') <> 0 then
          return false;
        end if;
        if metric_item.value ->> 'status' = 'unavailable' then
          section_unavailable_count := section_unavailable_count + 1;
        end if;
      else
        return false;
      end if;
    end loop;

    if section_metric_count <> cardinality(expected_metrics) or section_max_sum <> 50 then
      return false;
    end if;
    expected_section_status := case
      when section_scored_count = section_metric_count then 'scored'
      when section_unavailable_count > 0 then 'unavailable'
      else 'not_checked'
    end;
    if section_item.value ->> 'status' is distinct from expected_section_status then
      return false;
    end if;
    if expected_section_status = 'scored' then
      if jsonb_typeof(section_item.value -> 'earned_points') is distinct from 'number'
        or (section_item.value ->> 'earned_points')::numeric <> section_earned_sum then
        return false;
      end if;
      total_earned_sum := total_earned_sum + section_earned_sum;
    else
      all_sections_scored := false;
      if jsonb_typeof(section_item.value -> 'earned_points') is distinct from 'null' then
        return false;
      end if;
    end if;
  end loop;

  if section_count <> 2 or metric_count <> 11 then return false; end if;
  if all_sections_scored then
    if jsonb_typeof(payload -> 'total_earned_points') is distinct from 'number'
      or attempt_score is null
      or attempt_score not between 0 and 100
      or (payload ->> 'total_earned_points')::numeric <> total_earned_sum
      or total_earned_sum <> attempt_score
      or jsonb_typeof(payload -> 'recommendation') is distinct from 'object' then
      return false;
    end if;
    select array_agg(key order by key)
    into actual_keys
    from jsonb_object_keys(payload -> 'recommendation') as keys(key);
    return actual_keys = array['strongest_metric', 'text', 'weakest_metric']::text[]
      and payload -> 'recommendation' ->> 'strongest_metric' = any(array[
        'answered_prompt', 'specificity', 'structure', 'conciseness', 'word_choice', 'grammar',
        'pace', 'time_to_first_word', 'paused_time', 'articulation', 'energy'
      ]::text[])
      and payload -> 'recommendation' ->> 'weakest_metric' = any(array[
        'answered_prompt', 'specificity', 'structure', 'conciseness', 'word_choice', 'grammar',
        'pace', 'time_to_first_word', 'paused_time', 'articulation', 'energy'
      ]::text[])
      and jsonb_typeof(payload -> 'recommendation' -> 'text') = 'string'
      and nullif(btrim(payload -> 'recommendation' ->> 'text'), '') is not null;
  end if;

  return not require_complete
    and attempt_score is null
    and jsonb_typeof(payload -> 'total_earned_points') = 'null'
    and jsonb_typeof(payload -> 'recommendation') = 'null';
exception when others then
  return false;
end;
$$;

-- Keep v2 and v3 as separate immutable cohorts. The row rubric selects exactly
-- one validator; a payload from the other version is never reinterpreted.
create or replace function public.raise_lesson_progress_from_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  valid_payload boolean := false;
begin
  if new.lesson_id is null or new.status <> 'done' then
    return new;
  end if;

  valid_payload := case new.rubric_version
    when 'v2' then public.is_valid_v2_score_payload_for_attempt(
      new.section_scores,
      new.practice_mode,
      new.score,
      true
    )
    when 'v3' then public.is_valid_v3_score_payload_for_attempt(
      new.section_scores,
      new.practice_mode,
      new.score,
      true
    )
    else false
  end;
  if not valid_payload then return new; end if;

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

-- Replay exact completed v3 snapshots that landed while the previous trigger
-- understood only v2. The no-op column assignment fires the shared trigger, so
-- historical repair uses the same payload, lesson identity, tie, and monotonic
-- best-score checks as a newly completed attempt.
update public.attempts as attempt
set section_scores = attempt.section_scores
where attempt.lesson_id is not null
  and attempt.status = 'done'
  and attempt.rubric_version = 'v3'
  and public.is_valid_v3_score_payload_for_attempt(
    attempt.section_scores,
    attempt.practice_mode,
    attempt.score,
    true
  );

revoke all privileges on function public.is_valid_v3_score_payload_for_attempt(
  jsonb,
  text,
  integer,
  boolean
) from public, anon, authenticated, service_role;
grant execute on function public.is_valid_v3_score_payload_for_attempt(
  jsonb,
  text,
  integer,
  boolean
) to service_role;

revoke all privileges on function public.raise_lesson_progress_from_attempt()
  from public, anon, authenticated, service_role;
grant execute on function public.raise_lesson_progress_from_attempt() to service_role;

-- Reassert the existing v2 helper boundary so the additive migration leaves the
-- complete progression surface under the same least-privilege policy.
revoke all privileges on function public.is_valid_v2_score_payload_for_attempt(
  jsonb,
  text,
  integer,
  boolean
) from public, anon, authenticated, service_role;
grant execute on function public.is_valid_v2_score_payload_for_attempt(
  jsonb,
  text,
  integer,
  boolean
) to service_role;
