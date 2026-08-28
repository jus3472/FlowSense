-- Deterministic existing-user path preferences. Historical focus_areas remain
-- unchanged for compatibility; their stored ordering cannot reliably express
-- an intended primary path, so canonical path priority is used instead.

with mapped as (
  select
    profile.id as user_id,
    case
      when focus.value = 'interviews' then 'interviews'
      when focus.value = 'presentations' then 'presentations'
      when focus.value in (
        'meetings',
        'meetings-conversations',
        'difficult-conversations',
        'conversations'
      ) then 'conversations'
      when focus.value in (
        'speaking-on-the-spot',
        'general-speaking',
        'confidence',
        'speaking-english',
        'class'
      ) then 'general-speaking'
      else 'general-speaking'
    end as path_slug,
    case
      when focus.value = 'interviews' then 0
      when focus.value = 'presentations' then 1
      when focus.value in (
        'meetings',
        'meetings-conversations',
        'difficult-conversations',
        'conversations'
      ) then 2
      when focus.value in (
        'speaking-on-the-spot',
        'general-speaking',
        'confidence',
        'speaking-english',
        'class'
      ) then 3
      else 3
    end as canonical_position
  from public.profiles as profile
  cross join lateral unnest(
    case
      when cardinality(profile.focus_areas) = 0 then array['']::text[]
      else profile.focus_areas
    end
  ) as focus(value)
),
deduplicated as (
  select user_id, path_slug, min(canonical_position) as canonical_position
  from mapped
  group by user_id, path_slug
),
ranked as (
  select
    deduplicated.user_id,
    path.id as path_id,
    row_number() over (
      partition by deduplicated.user_id
      order by deduplicated.canonical_position, deduplicated.path_slug
    )::integer - 1 as rank
  from deduplicated
  join public.practice_paths as path
    on path.slug = deduplicated.path_slug and path.active
  where not exists (
    select 1
    from public.profile_path_preferences as existing
    where existing.user_id = deduplicated.user_id
  )
)
insert into public.profile_path_preferences (user_id, path_id, rank)
select user_id, path_id, rank
from ranked
order by user_id, rank
on conflict (user_id, path_id) do nothing;

-- Future signup gets a usable General Speaking foundation. Onboarding can
-- atomically replace it when the user confirms a primary path.
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

  insert into public.profile_path_preferences (user_id, path_id, rank)
  select new.id, path.id, 0
  from public.practice_paths as path
  where path.slug = 'general-speaking' and path.active
  on conflict (user_id, path_id) do nothing;

  return new;
end;
$$;
