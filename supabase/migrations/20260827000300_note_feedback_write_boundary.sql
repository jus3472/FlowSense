-- Stored score snapshots are server-owned, so the notes that alter their
-- legacy presentation must use the same authenticated route boundary. Owner
-- reads remain available because result pages reapply notes at read time.

-- NULLS NOT DISTINCT is required below so a null whole-response quote is
-- idempotent. Supabase uses PostgreSQL 15 or newer; fail explicitly on an
-- older database instead of silently weakening that invariant.
do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'note feedback hardening requires PostgreSQL 15 or newer'
      using errcode = '0A000';
  end if;
end;
$$;

-- Migrations run transactionally. This blocks INSERT, UPDATE, and DELETE until
-- cleanup, uniqueness, and the validation trigger all become visible together,
-- so an older service-route process cannot race a forged row into the gap.
lock table public.note_feedback in share row exclusive mode;

revoke insert, update, delete on public.note_feedback from public;
revoke insert, update, delete on public.note_feedback from anon;
revoke insert, update, delete on public.note_feedback from authenticated;
grant select on public.note_feedback to authenticated;
grant select, insert, update, delete on public.note_feedback to service_role;

drop policy if exists "note_feedback_insert_own" on public.note_feedback;
drop policy if exists "note_feedback_update_own" on public.note_feedback;
drop policy if exists "note_feedback_delete_own" on public.note_feedback;

-- The old browser policy allowed requests to bypass route validation. Invalid
-- historical rows are deleted because leaving them readable would preserve
-- the presentation bypass. Exact legitimate rows remain. Versioned results
-- are never disputable through this legacy mechanism.
delete from public.note_feedback as feedback
using public.attempts as attempt
where feedback.attempt_id = attempt.id
  and not (
    feedback.user_id = attempt.user_id
    and attempt.status = 'done'
    and not (coalesce(attempt.section_scores, '{}'::jsonb) ? 'version')
    and attempt.content_result ->> 'status' = 'checked'
    and (
      (
        feedback.note_type in (
          'answered',
          'explained',
          'word_choice',
          'logical_order',
          'no_repetition'
        )
        and attempt.content_result -> 'checks' -> feedback.note_type ->> 'passed' = 'false'
        and feedback.quote is not distinct from (
          attempt.content_result -> 'checks' -> feedback.note_type ->> 'quote'
        )
      )
      or (
        feedback.note_type = 'word_choice_span'
        and feedback.quote is not null
        and exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(attempt.content_result -> 'extra_spans') = 'array'
                then attempt.content_result -> 'extra_spans'
              else '[]'::jsonb
            end
          ) as span
          where span ->> 'text' = feedback.quote
        )
      )
    )
  );

-- Exact duplicate notes have always had the same scoring effect. Keep the
-- oldest representative before enforcing route-level retry idempotency.
delete from public.note_feedback as duplicate
using public.note_feedback as retained
where duplicate.user_id = retained.user_id
  and duplicate.attempt_id = retained.attempt_id
  and duplicate.note_type = retained.note_type
  and duplicate.quote is not distinct from retained.quote
  and (duplicate.created_at, duplicate.id) > (retained.created_at, retained.id);

create unique index note_feedback_exact_dispute_idx
  on public.note_feedback (user_id, attempt_id, note_type, quote) nulls not distinct;

create or replace function public.enforce_note_feedback_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.attempts as attempt
    where attempt.id = new.attempt_id
      and attempt.user_id = new.user_id
      and attempt.status = 'done'
      and not (coalesce(attempt.section_scores, '{}'::jsonb) ? 'version')
      and attempt.content_result ->> 'status' = 'checked'
      and (
        (
          new.note_type in (
            'answered',
            'explained',
            'word_choice',
            'logical_order',
            'no_repetition'
          )
          and attempt.content_result -> 'checks' -> new.note_type ->> 'passed' = 'false'
          and new.quote is not distinct from (
            attempt.content_result -> 'checks' -> new.note_type ->> 'quote'
          )
        )
        or (
          new.note_type = 'word_choice_span'
          and new.quote is not null
          and exists (
            select 1
            from jsonb_array_elements(
              case
                when jsonb_typeof(attempt.content_result -> 'extra_spans') = 'array'
                  then attempt.content_result -> 'extra_spans'
                else '[]'::jsonb
              end
            ) as span
            where span ->> 'text' = new.quote
          )
        )
      )
  ) then
    raise exception 'note feedback must match an exact checked legacy finding'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists note_feedback_enforce_target on public.note_feedback;
create trigger note_feedback_enforce_target
  before insert or update on public.note_feedback
  for each row execute function public.enforce_note_feedback_target();
