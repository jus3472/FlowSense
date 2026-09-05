-- Collapse the temporary multi-generation progression surface to the one
-- current scored-result contract. Attempts remain immutable; lesson_progress
-- is derived again from strict surviving v3.score.2 snapshots.

lock table public.attempts in share row exclusive mode;
lock table public.lesson_progress in share row exclusive mode;
lock table public.note_feedback in share row exclusive mode;

create or replace function public.is_valid_current_score_payload_for_attempt(
  payload jsonb,
  attempt_mode text,
  attempt_score integer
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
  section_max_sum integer;
  section_earned_sum numeric;
  total_earned_sum numeric := 0;
  component numeric;
  earned numeric;
  metric_rank integer;
  strongest_rank integer;
  weakest_rank integer;
  strongest_component numeric;
  weakest_component numeric;
  strongest_metric text;
  weakest_metric text;
  strongest_explanation text;
  weakest_explanation text;
  recommendation_text text;
  current_recommendation_text text;
  prior_recommendation_text text;
begin
  if payload is null
    or attempt_score is null
    or attempt_score not between 0 and 100
    or jsonb_typeof(payload) is distinct from 'object'
    or payload ->> 'version' is distinct from 'v3.score.2'
    or payload ->> 'rubric_version' is distinct from 'v3'
    or payload ->> 'mode' is distinct from attempt_mode
    or attempt_mode not in ('practice', 'interview', 'presentation', 'conversation')
    or jsonb_typeof(payload -> 'total_earned_points') is distinct from 'number'
    or jsonb_typeof(payload -> 'total_max_points') is distinct from 'number'
    or (payload ->> 'total_max_points')::numeric <> 100
    or jsonb_typeof(payload -> 'sections') is distinct from 'object'
    or jsonb_typeof(payload -> 'warnings') is distinct from 'array'
    or exists (
      select 1
      from jsonb_array_elements(payload -> 'warnings') as warning(value)
      where jsonb_typeof(warning.value) <> 'string'
        or (
          select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
          from regexp_split_to_table(warning.value #>> '{}', '') as chars(character)
        ) > 1000
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
      expected_metrics := array['pace', 'paused_time', 'articulation', 'energy']::text[];
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
      or section_item.value ->> 'status' is distinct from 'scored'
      or jsonb_typeof(section_item.value -> 'earned_points') is distinct from 'number'
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
        or metric_item.value ->> 'status' is distinct from 'scored'
        or jsonb_typeof(metric_item.value -> 'component') is distinct from 'number'
        or jsonb_typeof(metric_item.value -> 'earned_points') is distinct from 'number'
        or jsonb_typeof(metric_item.value -> 'max_points') is distinct from 'number'
        or (metric_item.value ->> 'max_points')::numeric <> expected_max
        or jsonb_typeof(metric_item.value -> 'explanation') is distinct from 'string'
        or nullif(btrim(metric_item.value ->> 'explanation'), '') is null
        or (
          select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
          from regexp_split_to_table(metric_item.value ->> 'explanation', '') as chars(character)
        ) > 1000
        or jsonb_typeof(metric_item.value -> 'measurements') not in ('object', 'null')
        or (
          jsonb_typeof(metric_item.value -> 'measurements') = 'object'
          and exists (
            select 1
            from jsonb_each(metric_item.value -> 'measurements') as measurement(key, value)
            where jsonb_typeof(measurement.value) not in ('string', 'number', 'boolean', 'null')
              or (
                jsonb_typeof(measurement.value) = 'number'
                and abs((measurement.value #>> '{}')::numeric) > 1.7976931348623157e308::numeric
              )
          )
        )
        or jsonb_typeof(metric_item.value -> 'evidence') is distinct from 'array'
        or jsonb_typeof(metric_item.value -> 'details') is distinct from 'array'
        or jsonb_typeof(metric_item.value -> 'warnings') is distinct from 'array'
        or exists (
          select 1
          from jsonb_array_elements(metric_item.value -> 'warnings') as warning(value)
          where jsonb_typeof(warning.value) <> 'string'
            or (
              select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
              from regexp_split_to_table(warning.value #>> '{}', '') as chars(character)
            ) > 1000
        ) then
        return false;
      end if;

      if exists (
        select 1
        from jsonb_array_elements(metric_item.value -> 'evidence') as evidence(value)
        where jsonb_typeof(evidence.value) <> 'object'
          or (
            select array_agg(key order by key)
            from jsonb_object_keys(evidence.value) as keys(key)
          ) is distinct from array['coordinate', 'detail', 'end', 'quote', 'source', 'start']::text[]
          or jsonb_typeof(evidence.value -> 'source') <> 'string'
          or (
            select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
            from regexp_split_to_table(evidence.value ->> 'source', '') as chars(character)
          ) not between 1 and 100
          or jsonb_typeof(evidence.value -> 'detail') <> 'string'
          or (
            select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
            from regexp_split_to_table(evidence.value ->> 'detail', '') as chars(character)
          ) not between 1 and 1000
          or jsonb_typeof(evidence.value -> 'quote') not in ('string', 'null')
          or not (
            (
              jsonb_typeof(evidence.value -> 'start') = 'null'
              and jsonb_typeof(evidence.value -> 'end') = 'null'
              and jsonb_typeof(evidence.value -> 'coordinate') = 'null'
              and jsonb_typeof(evidence.value -> 'quote') = 'null'
            )
            or (
              jsonb_typeof(evidence.value -> 'start') = 'number'
              and jsonb_typeof(evidence.value -> 'end') = 'number'
              and (evidence.value ->> 'start')::numeric >= 0
              and (evidence.value ->> 'end')::numeric > (evidence.value ->> 'start')::numeric
              and (evidence.value ->> 'end')::numeric <= 1.7976931348623157e308::numeric
              and jsonb_typeof(evidence.value -> 'coordinate') = 'object'
              and (
                select array_agg(key order by key)
                from jsonb_object_keys(evidence.value -> 'coordinate') as keys(key)
              ) is not distinct from array['space', 'unit']::text[]
              and (
                (
                  evidence.value -> 'coordinate' ->> 'space' = 'transcript'
                  and evidence.value -> 'coordinate' ->> 'unit' = 'utf16_code_unit'
                  and (evidence.value ->> 'start')::numeric = trunc((evidence.value ->> 'start')::numeric)
                  and (evidence.value ->> 'end')::numeric = trunc((evidence.value ->> 'end')::numeric)
                  and (
                    jsonb_typeof(evidence.value -> 'quote') = 'null'
                    or (
                      select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
                      from regexp_split_to_table(evidence.value ->> 'quote', '') as chars(character)
                    ) = (evidence.value ->> 'end')::numeric - (evidence.value ->> 'start')::numeric
                  )
                )
                or (
                  evidence.value -> 'coordinate' ->> 'space' = 'audio_timeline'
                  and evidence.value -> 'coordinate' ->> 'unit' in ('millisecond', 'second')
                )
              )
            )
          )
      ) then
        return false;
      end if;

      if exists (
        select 1
        from jsonb_array_elements(metric_item.value -> 'details') as detail(value)
        where jsonb_typeof(detail.value) <> 'object'
          or (
            select array_agg(key order by key)
            from jsonb_object_keys(detail.value) as keys(key)
          ) is distinct from array['evidence', 'kind', 'observation', 'quote', 'source', 'suggestion']::text[]
          or jsonb_typeof(detail.value -> 'kind') <> 'string'
          or (
            select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
            from regexp_split_to_table(detail.value ->> 'kind', '') as chars(character)
          ) not between 1 and 100
          or jsonb_typeof(detail.value -> 'source') <> 'string'
          or detail.value ->> 'source' not in ('ai', 'mechanical', 'audio')
          or jsonb_typeof(detail.value -> 'quote') not in ('string', 'null')
          or jsonb_typeof(detail.value -> 'observation') <> 'string'
          or (
            select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
            from regexp_split_to_table(detail.value ->> 'observation', '') as chars(character)
          ) not between 1 and 1000
          or jsonb_typeof(detail.value -> 'suggestion') not in ('string', 'null')
          or (
            jsonb_typeof(detail.value -> 'suggestion') = 'string'
            and (
              select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
              from regexp_split_to_table(detail.value ->> 'suggestion', '') as chars(character)
            ) > 1000
          )
          or jsonb_typeof(detail.value -> 'evidence') <> 'array'
          or exists (
            select 1
            from jsonb_array_elements(detail.value -> 'evidence') as evidence(value)
            where jsonb_typeof(evidence.value) <> 'object'
              or (
                select array_agg(key order by key)
                from jsonb_object_keys(evidence.value) as keys(key)
              ) is distinct from array['coordinate', 'detail', 'end', 'quote', 'source', 'start']::text[]
              or jsonb_typeof(evidence.value -> 'source') <> 'string'
              or (
                select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
                from regexp_split_to_table(evidence.value ->> 'source', '') as chars(character)
              ) not between 1 and 100
              or jsonb_typeof(evidence.value -> 'detail') <> 'string'
              or (
                select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
                from regexp_split_to_table(evidence.value ->> 'detail', '') as chars(character)
              ) not between 1 and 1000
              or jsonb_typeof(evidence.value -> 'quote') not in ('string', 'null')
              or not (
                (
                  jsonb_typeof(evidence.value -> 'start') = 'null'
                  and jsonb_typeof(evidence.value -> 'end') = 'null'
                  and jsonb_typeof(evidence.value -> 'coordinate') = 'null'
                  and jsonb_typeof(evidence.value -> 'quote') = 'null'
                )
                or (
                  jsonb_typeof(evidence.value -> 'start') = 'number'
                  and jsonb_typeof(evidence.value -> 'end') = 'number'
                  and (evidence.value ->> 'start')::numeric >= 0
                  and (evidence.value ->> 'end')::numeric > (evidence.value ->> 'start')::numeric
                  and (evidence.value ->> 'end')::numeric <= 1.7976931348623157e308::numeric
                  and jsonb_typeof(evidence.value -> 'coordinate') = 'object'
                  and (
                    select array_agg(key order by key)
                    from jsonb_object_keys(evidence.value -> 'coordinate') as keys(key)
                  ) is not distinct from array['space', 'unit']::text[]
                  and (
                    (
                      evidence.value -> 'coordinate' ->> 'space' = 'transcript'
                      and evidence.value -> 'coordinate' ->> 'unit' = 'utf16_code_unit'
                      and (evidence.value ->> 'start')::numeric = trunc((evidence.value ->> 'start')::numeric)
                      and (evidence.value ->> 'end')::numeric = trunc((evidence.value ->> 'end')::numeric)
                      and (
                        jsonb_typeof(evidence.value -> 'quote') = 'null'
                        or (
                          select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
                          from regexp_split_to_table(evidence.value ->> 'quote', '') as chars(character)
                        ) = (evidence.value ->> 'end')::numeric - (evidence.value ->> 'start')::numeric
                      )
                    )
                    or (
                      evidence.value -> 'coordinate' ->> 'space' = 'audio_timeline'
                      and evidence.value -> 'coordinate' ->> 'unit' in ('millisecond', 'second')
                    )
                  )
                )
              )
          )
          or (
            jsonb_typeof(detail.value -> 'quote') = 'string'
            and not exists (
              select 1
              from jsonb_array_elements(detail.value -> 'evidence') as evidence(value)
              where evidence.value ->> 'quote' = detail.value ->> 'quote'
            )
          )
      ) then
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

      section_max_sum := section_max_sum + expected_max;
      section_earned_sum := section_earned_sum + earned;

      if strongest_component is null
        or component > strongest_component
        or (component = strongest_component and metric_rank < strongest_rank) then
        strongest_component := component;
        strongest_rank := metric_rank;
        strongest_metric := metric_item.key;
        strongest_explanation := metric_item.value ->> 'explanation';
      end if;
      if weakest_component is null
        or component < weakest_component
        or (component = weakest_component and metric_rank > weakest_rank) then
        weakest_component := component;
        weakest_rank := metric_rank;
        weakest_metric := metric_item.key;
        weakest_explanation := metric_item.value ->> 'explanation';
      end if;
    end loop;

    if section_metric_count <> cardinality(expected_metrics)
      or section_max_sum <> 50
      or (section_item.value ->> 'earned_points')::numeric <> section_earned_sum then
      return false;
    end if;
    total_earned_sum := total_earned_sum + section_earned_sum;
  end loop;

  if section_count <> 2
    or metric_count <> 10
    or total_earned_sum <> attempt_score
    or (payload ->> 'total_earned_points')::numeric <> total_earned_sum
    or jsonb_typeof(payload -> 'recommendation') is distinct from 'object' then
    return false;
  end if;

  select array_agg(key order by key)
  into actual_keys
  from jsonb_object_keys(payload -> 'recommendation') as keys(key);
  if actual_keys is distinct from array['strongest_metric', 'text', 'weakest_metric']::text[]
    or payload -> 'recommendation' ->> 'strongest_metric' is distinct from strongest_metric
    or payload -> 'recommendation' ->> 'weakest_metric' is distinct from weakest_metric
    or jsonb_typeof(payload -> 'recommendation' -> 'text') is distinct from 'string' then
    return false;
  end if;

  recommendation_text := payload -> 'recommendation' ->> 'text';
  current_recommendation_text := case strongest_metric
    when 'answered_prompt' then 'You did well at fully addressing what the prompt asked.'
    when 'specificity' then 'You did well at supporting your answer with concrete details.'
    when 'structure' then 'You did well at organizing your ideas clearly.'
    when 'conciseness' then 'You did well at keeping your response focused.'
    when 'word_choice' then 'You did well at choosing precise words.'
    when 'grammar' then 'You did well at using spoken grammar that kept your meaning clear.'
    when 'pace' then 'You did well at using a pace that made your ideas easy to follow.'
    when 'paused_time' then 'You did well at keeping hesitation from interrupting your response.'
    when 'articulation' then 'You did well at making your words easy to understand.'
    when 'energy' then 'You did well at using natural vocal variation.'
  end || ' To improve' || case when weakest_component >= 0.8 then ' even further' else '' end ||
  ', ' || case weakest_metric
    when 'answered_prompt' then 'address every part of the prompt more directly.'
    when 'specificity' then 'support your answer with more concrete details.'
    when 'structure' then 'organize your ideas in a clearer sequence.'
    when 'conciseness' then 'cut unnecessary wording and repetition.'
    when 'word_choice' then 'choose more precise words where your meaning is vague.'
    when 'grammar' then 'clean up spoken grammar that makes your meaning less clear.'
    when 'pace' then 'adjust your pace so your ideas are easier to follow.'
    when 'paused_time' then 'reduce long hesitations so your response flows more smoothly.'
    when 'articulation' then 'focus on making each word easier to understand.'
    when 'energy' then 'add more natural vocal variation so your voice sounds less flat.'
  end;
  prior_recommendation_text := case
    when strongest_metric = weakest_metric then strongest_explanation
    else strongest_explanation || ' ' || weakest_explanation
  end;

  return recommendation_text = current_recommendation_text
    or recommendation_text = prior_recommendation_text;
exception when others then
  return false;
end;
$$;

create or replace function public.raise_lesson_progress_from_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_path_id uuid;
  current_chapter_position integer;
  current_lesson_position integer;
  previous_lesson_id uuid;
begin
  if new.lesson_id is null
    or new.status <> 'done'
    or new.rubric_version is distinct from 'v3'
    or not public.is_valid_current_score_payload_for_attempt(
      new.section_scores,
      new.practice_mode,
      new.score
    ) then
    return new;
  end if;

  select path.id, chapter.position, lesson.position
  into current_path_id, current_chapter_position, current_lesson_position
  from public.practice_lessons as lesson
  join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
  join public.practice_paths as path on path.id = chapter.path_id
  join public.prompts as prompt on prompt.id = lesson.prompt_id
  where lesson.id = new.lesson_id
    and lesson.prompt_id = new.prompt_id
    and prompt.id = new.prompt_id
    and prompt.mode = path.mode
    and prompt.difficulty = chapter.level
    and path.mode = new.practice_mode
    and new.prompt_source = 'library'
    and new.prompt_difficulty = chapter.level
    and lesson.active and chapter.active and path.active and prompt.active;

  if current_path_id is null then return new; end if;

  select lesson.id
  into previous_lesson_id
  from public.practice_lessons as lesson
  join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
  join public.prompts as prompt on prompt.id = lesson.prompt_id
  where chapter.path_id = current_path_id
    and lesson.active and chapter.active and prompt.active
    and prompt.mode = new.practice_mode
    and prompt.difficulty = chapter.level
    and (chapter.position, lesson.position) <
      (current_chapter_position, current_lesson_position)
  order by chapter.position desc, lesson.position desc
  limit 1;

  if previous_lesson_id is not null and not exists (
    select 1
    from public.lesson_progress as progress
    where progress.user_id = new.user_id
      and progress.lesson_id = previous_lesson_id
      and progress.best_score >= 70
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

create or replace function public.enforce_lesson_progress_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_path_id uuid;
  current_chapter_position integer;
  current_lesson_position integer;
  previous_lesson_id uuid;
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

  if new.best_attempt_id is null then
    if tg_op = 'INSERT' then
      raise exception 'lesson best requires a current scored attempt' using errcode = '23514';
    end if;
    if new.best_score is distinct from old.best_score then
      raise exception 'lesson best requires a current scored attempt' using errcode = '23514';
    end if;
    return new;
  end if;

  select path.id, chapter.position, lesson.position
  into current_path_id, current_chapter_position, current_lesson_position
  from public.practice_lessons as lesson
  join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
  join public.practice_paths as path on path.id = chapter.path_id
  join public.prompts as prompt on prompt.id = lesson.prompt_id
  join public.attempts as attempt on attempt.id = new.best_attempt_id
  where lesson.id = new.lesson_id
    and attempt.user_id = new.user_id
    and attempt.lesson_id = new.lesson_id
    and attempt.prompt_id = lesson.prompt_id
    and attempt.prompt_id = prompt.id
    and attempt.status = 'done'
    and attempt.rubric_version = 'v3'
    and attempt.score = new.best_score
    and attempt.practice_mode = path.mode
    and attempt.prompt_source = 'library'
    and attempt.prompt_difficulty = chapter.level
    and prompt.mode = path.mode
    and prompt.difficulty = chapter.level
    and lesson.active and chapter.active and path.active and prompt.active
    and public.is_valid_current_score_payload_for_attempt(
      attempt.section_scores,
      attempt.practice_mode,
      attempt.score
    );

  if current_path_id is null then
    raise exception 'lesson best attempt must be a valid current structured result'
      using errcode = '23514';
  end if;

  select lesson.id
  into previous_lesson_id
  from public.practice_lessons as lesson
  join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
  join public.practice_paths as path on path.id = chapter.path_id
  join public.prompts as prompt on prompt.id = lesson.prompt_id
  where chapter.path_id = current_path_id
    and lesson.active and chapter.active and path.active and prompt.active
    and prompt.mode = path.mode
    and prompt.difficulty = chapter.level
    and (chapter.position, lesson.position) <
      (current_chapter_position, current_lesson_position)
  order by chapter.position desc, lesson.position desc
  limit 1;

  if previous_lesson_id is not null and not exists (
    select 1
    from public.lesson_progress as progress
    where progress.user_id = new.user_id
      and progress.lesson_id = previous_lesson_id
      and progress.best_score >= 70
  ) then
    raise exception 'lesson progress must follow a passing previous lesson'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Preserve audit timestamps where the same lesson already had derived state,
-- but rebuild every best from surviving strict-current attempts only.
create temporary table previous_lesson_progress on commit drop as
select * from public.lesson_progress;

delete from public.lesson_progress;

do $$
declare
  lesson_record record;
begin
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
      candidate.user_id,
      lesson_record.lesson_id,
      candidate.score,
      candidate.id,
      coalesce(previous.created_at, candidate.finished_at, candidate.created_at, now()),
      case
        when previous.best_score = candidate.score
          and previous.best_attempt_id = candidate.id then previous.updated_at
        else coalesce(candidate.finished_at, candidate.created_at, now())
      end
    from (
      select distinct on (attempt.user_id)
        attempt.id,
        attempt.user_id,
        attempt.score,
        attempt.finished_at,
        attempt.created_at
      from public.attempts as attempt
      join public.practice_lessons as lesson on lesson.id = attempt.lesson_id
      join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
      join public.practice_paths as path on path.id = chapter.path_id
      join public.prompts as prompt on prompt.id = lesson.prompt_id
      where attempt.lesson_id = lesson_record.lesson_id
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
            where progress.user_id = attempt.user_id
              and progress.lesson_id = lesson_record.previous_lesson_id
              and progress.best_score >= 70
          )
        )
      order by
        attempt.user_id,
        attempt.score desc,
        attempt.finished_at desc nulls last,
        attempt.id desc
    ) as candidate
    left join pg_temp.previous_lesson_progress as previous
      on previous.user_id = candidate.user_id
      and previous.lesson_id = lesson_record.lesson_id;
  end loop;
end;
$$;

drop trigger if exists note_feedback_enforce_target on public.note_feedback;
drop function if exists public.enforce_note_feedback_target();

-- Retain historical note rows conservatively, but leave the unused archive
-- read-only now that no current application path validates or writes it.
revoke all privileges on table public.note_feedback
  from public, anon, authenticated, service_role;
grant select on table public.note_feedback to authenticated, service_role;

drop function if exists public.is_valid_v3_score_payload_for_attempt(jsonb, text, integer, boolean);
drop function if exists public.is_valid_v3_score_1_payload_for_attempt(jsonb, text, integer, boolean);
drop function if exists public.is_valid_v3_score_2_payload_for_attempt(jsonb, text, integer, boolean);
drop function if exists public.is_valid_v2_score_payload_for_attempt(jsonb, text, integer, boolean);

revoke all privileges on function public.is_valid_current_score_payload_for_attempt(
  jsonb,
  text,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.is_valid_current_score_payload_for_attempt(
  jsonb,
  text,
  integer
) to service_role;

revoke all privileges on function public.raise_lesson_progress_from_attempt()
  from public, anon, authenticated, service_role;
grant execute on function public.raise_lesson_progress_from_attempt() to service_role;

revoke all privileges on function public.enforce_lesson_progress_integrity()
  from public, anon, authenticated, service_role;
grant execute on function public.enforce_lesson_progress_integrity() to service_role;
