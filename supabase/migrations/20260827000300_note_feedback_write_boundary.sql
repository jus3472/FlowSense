-- Stored score snapshots are server-owned, so the notes that alter their
-- legacy presentation must use the same authenticated route boundary. Owner
-- reads remain available because result pages reapply notes at read time.

revoke insert, update, delete on public.note_feedback from public;
revoke insert, update, delete on public.note_feedback from anon;
revoke insert, update, delete on public.note_feedback from authenticated;
grant select on public.note_feedback to authenticated;
grant select, insert, update, delete on public.note_feedback to service_role;

drop policy if exists "note_feedback_insert_own" on public.note_feedback;
drop policy if exists "note_feedback_update_own" on public.note_feedback;
drop policy if exists "note_feedback_delete_own" on public.note_feedback;

-- The old browser policy allowed requests to bypass route validation. Retain
-- only rows that still identify an exact checked legacy finding. Versioned
-- results are never disputable through this legacy mechanism.
delete from public.note_feedback as feedback
using public.attempts as attempt
where feedback.attempt_id = attempt.id
  and not (
    feedback.user_id = attempt.user_id
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
