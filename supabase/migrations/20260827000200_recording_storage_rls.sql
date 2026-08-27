-- Browser recording writes must correspond to one server-owned attempt that
-- is still accepting its upload. The stored metrics path is the authoritative
-- object name, while the explicit prefix check fails closed for legacy or
-- corrupt attempt metadata that points outside the owner's folder.

drop policy if exists "recordings_insert_own" on storage.objects;
create policy "recordings_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and exists (
      select 1
      from public.attempts as attempt
      where attempt.user_id = (select auth.uid())
        and attempt.status = 'uploading'
        and attempt.metrics #>> '{upload,storage_path}' = name
    )
  );

-- The same path may be upserted while an upload is active so a network retry
-- does not require another attempt. Both the existing and replacement row
-- must continue to match the active server-owned attempt.
drop policy if exists "recordings_update_own" on storage.objects;
create policy "recordings_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and exists (
      select 1
      from public.attempts as attempt
      where attempt.user_id = (select auth.uid())
        and attempt.status = 'uploading'
        and attempt.metrics #>> '{upload,storage_path}' = name
    )
  )
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and exists (
      select 1
      from public.attempts as attempt
      where attempt.user_id = (select auth.uid())
        and attempt.status = 'uploading'
        and attempt.metrics #>> '{upload,storage_path}' = name
    )
  );

-- Owner reads retain the existing prefix policy. Browser deletion is removed;
-- the service-role attempt deletion route remains the only mutation boundary
-- after upload processing begins.
drop policy if exists "recordings_delete_own" on storage.objects;
