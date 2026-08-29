import pg from 'pg'
import {
  applyMigration,
  assertDisposableDatabaseUrl,
  databaseClientOptions,
  loadEnvFile,
  loadMigrations,
} from './lib/migrations.mjs'

const USERS = {
  missingProfile: '10000000-0000-4000-8000-000000000001',
  owner: '20000000-0000-4000-8000-000000000002',
  other: '30000000-0000-4000-8000-000000000003',
  signedUpAfterCurriculum: '40000000-0000-4000-8000-000000000008',
}
const UPLOAD_ATTEMPTS = {
  owner: '50000000-0000-4000-8000-000000000005',
  other: '60000000-0000-4000-8000-000000000006',
  corrupt: '70000000-0000-4000-8000-000000000007',
}
const LEGACY_CREATED_AT = '2024-02-03T04:05:06.000Z'

function recordingPath(userId, attemptId) {
  return `${userId}/${attemptId}.webm`
}

loadEnvFile('.env.local')

const connectionString = process.env.FLOWSENSE_MIGRATION_TEST_URL
if (!connectionString) {
  console.error(
    'FLOWSENSE_MIGRATION_TEST_URL is required and must name an obviously disposable database.',
  )
  process.exit(1)
}

try {
  assertDisposableDatabaseUrl(connectionString)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const client = new pg.Client(databaseClientOptions(connectionString))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectPgError(run, expectedCode, message) {
  try {
    await run()
  } catch (error) {
    if (error.code === expectedCode) return
    throw new Error(`${message}: expected PostgreSQL ${expectedCode}, received ${error.code}`, {
      cause: error,
    })
  }
  throw new Error(`${message}: statement unexpectedly succeeded`)
}

async function bootstrapSupabaseSurface() {
  await client.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    drop schema if exists supabase_migrations cascade;
    create schema public;
    create schema auth;
    create schema storage;

    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end
    $$;

    grant usage on schema public, auth, storage to anon, authenticated, service_role;

    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false
    );

    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets (id) on delete cascade,
      name text not null
    );

    create or replace function storage.foldername(object_name text)
    returns text[]
    language sql
    immutable
    as $$
      select string_to_array(object_name, '/')
    $$;

    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated, service_role;
    grant execute on function storage.foldername(text) to authenticated, service_role;
  `)
}

async function seedAuthUser(id, displayName) {
  await client.query(
    `insert into auth.users (id, raw_user_meta_data)
     values ($1, jsonb_build_object('display_name', $2::text))`,
    [id, displayName],
  )
}

async function applyAll(migrations) {
  for (const migration of migrations) await applyMigration(client, migration)
}

async function reapplyStorageHardening(migrations, label) {
  const migration = migrations.find(({ name }) => name === 'recording_storage_rls')
  assert(migration, `${label}: recording storage hardening migration is missing`)
  await applyMigration(client, migration)
}

async function assertPromptCoverage(label) {
  const summary = await client.query(`
    select count(*)::integer as total,
      count(distinct (mode, difficulty))::integer as combinations
    from public.prompts
    where active and free_practice_visible
  `)
  assert(summary.rows[0]?.total === 60, `${label}: expected 60 active prompts`)
  assert(summary.rows[0]?.combinations === 12, `${label}: expected all 12 mode combinations`)

  const missing = await client.query(`
    with expected (mode, difficulty) as (
      values
        ('practice', 'beginner'), ('practice', 'intermediate'), ('practice', 'advanced'),
        ('interview', 'beginner'), ('interview', 'intermediate'), ('interview', 'advanced'),
        ('presentation', 'beginner'), ('presentation', 'intermediate'), ('presentation', 'advanced'),
        ('conversation', 'beginner'), ('conversation', 'intermediate'), ('conversation', 'advanced')
    )
    select expected.mode, expected.difficulty
    from expected
    where not exists (
      select 1 from public.prompts
      where prompts.active
        and prompts.free_practice_visible
        and prompts.mode = expected.mode
        and prompts.difficulty = expected.difficulty
    )
  `)
  assert(missing.rowCount === 0, `${label}: a mode and difficulty pair has no prompt`)
}

async function setAuthenticatedUser(userId) {
  await client.query('set role authenticated')
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
}

async function resetRole() {
  await client.query('reset role')
  await client.query("select set_config('request.jwt.claim.sub', '', false)")
}

async function assertAttemptSecurity(label) {
  const privileges = await client.query(`
    select privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'attempts'
      and grantee = 'authenticated'
    order by privilege_type
  `)
  assert(
    JSON.stringify(privileges.rows.map((row) => row.privilege_type)) === '["SELECT"]',
    `${label}: authenticated attempt privileges must be SELECT only`,
  )

  const policies = await client.query(`
    select cmd
    from pg_policies
    where schemaname = 'public'
      and tablename = 'attempts'
    order by cmd
  `)
  assert(
    JSON.stringify(policies.rows.map((row) => row.cmd)) === '["SELECT"]',
    `${label}: attempts must retain only the owner SELECT policy`,
  )

  const rls = await client.query(`
    select relrowsecurity
    from pg_class
    where oid = 'public.attempts'::regclass
  `)
  assert(rls.rows[0]?.relrowsecurity === true, `${label}: attempts RLS must stay enabled`)

  const storagePolicies = await client.query(`
    select policyname, cmd
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'recordings_%'
    order by cmd
  `)
  assert(
    JSON.stringify(storagePolicies.rows.map((row) => row.cmd)) === '["INSERT","SELECT","UPDATE"]',
    `${label}: recording policies must exclude authenticated DELETE`,
  )

  const ownAttempt = await client.query(
    `insert into public.attempts (user_id, prompt_text, status, finished_at)
     values ($1, 'Owned snapshot', 'done', now())
     returning id`,
    [USERS.owner],
  )
  await client.query(
    `insert into public.attempts (user_id, prompt_text, status, finished_at)
     values ($1, 'Other snapshot', 'done', now())`,
    [USERS.other],
  )
  const ownerStoragePath = recordingPath(USERS.owner, UPLOAD_ATTEMPTS.owner)
  const otherStoragePath = recordingPath(USERS.other, UPLOAD_ATTEMPTS.other)
  const corruptCrossUserPath = recordingPath(USERS.other, UPLOAD_ATTEMPTS.corrupt)
  await client.query(
    `insert into public.attempts (id, user_id, prompt_text, status, metrics)
     values ($1, $2, 'Owned upload', 'uploading',
       jsonb_build_object('upload', jsonb_build_object('storage_path', $3::text)))`,
    [UPLOAD_ATTEMPTS.owner, USERS.owner, ownerStoragePath],
  )
  await client.query(
    `insert into public.attempts (id, user_id, prompt_text, status, metrics)
     values ($1, $2, 'Other upload', 'uploading',
       jsonb_build_object('upload', jsonb_build_object('storage_path', $3::text)))`,
    [UPLOAD_ATTEMPTS.other, USERS.other, otherStoragePath],
  )
  await client.query(
    `insert into public.attempts (id, user_id, prompt_text, status, metrics)
     values ($1, $2, 'Corrupt legacy upload path', 'uploading',
       jsonb_build_object('upload', jsonb_build_object('storage_path', $3::text)))`,
    [UPLOAD_ATTEMPTS.corrupt, USERS.owner, corruptCrossUserPath],
  )

  await setAuthenticatedUser(USERS.owner)
  try {
    const visible = await client.query(
      'select id, user_id from public.attempts order by created_at',
    )
    assert(
      visible.rows.some((row) => row.id === ownAttempt.rows[0].id),
      `${label}: owner could not read their attempt`,
    )
    assert(
      visible.rows.every((row) => row.user_id === USERS.owner),
      `${label}: owner could read another user's attempt`,
    )

    await expectPgError(
      () =>
        client.query(
          `update public.attempts
           set score = 100,
             transcript = 'forged',
             section_scores = '{"forged":true}'::jsonb,
             metrics = '{"capture":"forged"}'::jsonb,
             content_result = '{"forged":true}'::jsonb
           where id = $1`,
          [ownAttempt.rows[0].id],
        ),
      '42501',
      `${label}: authenticated scoring mutation`,
    )
    await expectPgError(
      () =>
        client.query(
          `insert into public.attempts (user_id, prompt_text)
           values ($1, 'Forged insert')`,
          [USERS.owner],
        ),
      '42501',
      `${label}: authenticated attempt insert`,
    )

    const uploaded = await client.query(
      `insert into storage.objects (bucket_id, name)
       values ('recordings', $1)
       returning name`,
      [ownerStoragePath],
    )
    assert(uploaded.rowCount === 1, `${label}: exact active attempt upload was denied`)

    const retried = await client.query(
      `update storage.objects
       set name = name
       where bucket_id = 'recordings' and name = $1
       returning name`,
      [ownerStoragePath],
    )
    assert(retried.rowCount === 1, `${label}: active upload retry was denied`)

    await expectPgError(
      () =>
        client.query(
          `insert into storage.objects (bucket_id, name)
           values ('recordings', $1)`,
          [`${USERS.owner}/orphan.webm`],
        ),
      '42501',
      `${label}: arbitrary owner-prefix upload`,
    )
    await expectPgError(
      () =>
        client.query(
          `insert into storage.objects (bucket_id, name)
           values ('recordings', $1)`,
          [otherStoragePath],
        ),
      '42501',
      `${label}: cross-user upload`,
    )
    await expectPgError(
      () =>
        client.query(
          `insert into storage.objects (bucket_id, name)
           values ('recordings', $1)`,
          [corruptCrossUserPath],
        ),
      '42501',
      `${label}: corrupt owned attempt cross-user upload`,
    )
    await expectPgError(
      () =>
        client.query(
          `update storage.objects
           set name = $2
           where bucket_id = 'recordings' and name = $1`,
          [ownerStoragePath, `${USERS.owner}/renamed.webm`],
        ),
      '42501',
      `${label}: upload path rewrite`,
    )

    const storageRows = await client.query('select name from storage.objects')
    assert(
      storageRows.rowCount === 1 && storageRows.rows[0]?.name === ownerStoragePath,
      `${label}: owner storage read or upload failed`,
    )
  } finally {
    await resetRole()
  }

  await client.query('set role service_role')
  try {
    const serviceInsert = await client.query(
      `insert into storage.objects (bucket_id, name)
       values ('recordings', $1)
       returning name`,
      [otherStoragePath],
    )
    assert(serviceInsert.rowCount === 1, `${label}: service-role storage insert failed`)
  } finally {
    await resetRole()
  }

  await setAuthenticatedUser(USERS.owner)
  try {
    const storageRows = await client.query('select name from storage.objects')
    assert(
      storageRows.rowCount === 1 && storageRows.rows[0]?.name === ownerStoragePath,
      `${label}: owner could read another user's recording`,
    )
  } finally {
    await resetRole()
  }

  await client.query("update public.attempts set status = 'transcribing' where id = $1", [
    UPLOAD_ATTEMPTS.owner,
  ])
  await setAuthenticatedUser(USERS.owner)
  try {
    const postUploadRewrite = await client.query(
      `update storage.objects
       set name = name
       where bucket_id = 'recordings' and name = $1
       returning name`,
      [ownerStoragePath],
    )
    assert(
      postUploadRewrite.rowCount === 0,
      `${label}: processed recording remained authenticated-updateable`,
    )
    await expectPgError(
      () =>
        client.query(
          `insert into storage.objects (bucket_id, name)
           values ('recordings', $1)`,
          [ownerStoragePath],
        ),
      '42501',
      `${label}: processed recording reinsert`,
    )
    const authenticatedDelete = await client.query(
      `delete from storage.objects
       where bucket_id = 'recordings' and name = $1
       returning name`,
      [ownerStoragePath],
    )
    assert(
      authenticatedDelete.rowCount === 0,
      `${label}: authenticated recording delete bypassed RLS`,
    )
  } finally {
    await resetRole()
  }

  await client.query('set role service_role')
  try {
    const serviceUpdate = await client.query(
      `update storage.objects
       set name = name
       where bucket_id = 'recordings' and name = $1
       returning name`,
      [ownerStoragePath],
    )
    assert(serviceUpdate.rowCount === 1, `${label}: service-role recording update failed`)
    const serviceDelete = await client.query(
      `delete from storage.objects
       where bucket_id = 'recordings' and name = $1
       returning name`,
      [ownerStoragePath],
    )
    assert(serviceDelete.rowCount === 1, `${label}: service-role recording delete failed`)
  } finally {
    await resetRole()
  }
}

async function assertNoteFeedbackSecurity(label) {
  const privileges = await client.query(`
    select privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'note_feedback'
      and grantee = 'authenticated'
    order by privilege_type
  `)
  assert(
    JSON.stringify(privileges.rows.map((row) => row.privilege_type)) === '["SELECT"]',
    `${label}: authenticated note-feedback privileges must be SELECT only`,
  )

  const policies = await client.query(`
    select cmd
    from pg_policies
    where schemaname = 'public'
      and tablename = 'note_feedback'
    order by cmd
  `)
  assert(
    JSON.stringify(policies.rows.map((row) => row.cmd)) === '["SELECT"]',
    `${label}: note feedback must retain only the owner SELECT policy`,
  )

  const checkedLegacyContent = JSON.stringify({
    status: 'checked',
    checks: {
      answered: { passed: false, quote: null },
      explained: { passed: false, quote: 'exact stored quote' },
      logical_order: { passed: true, quote: null },
    },
    extra_spans: [{ text: 'exact stored span', category: 'imprecise' }],
  })
  const ownerAttempt = await client.query(
    `insert into public.attempts (
       user_id, prompt_text, score, section_scores, content_result, status, finished_at
     ) values ($1, 'Owner dispute snapshot', 42, '{"content":{},"delivery":{}}'::jsonb,
       $2::jsonb, 'done', now())
     returning id, score, section_scores, content_result`,
    [USERS.owner, checkedLegacyContent],
  )
  const otherAttempt = await client.query(
    `insert into public.attempts (
       user_id, prompt_text, score, section_scores, content_result, status, finished_at
     ) values ($1, 'Other dispute snapshot', 42, '{"content":{},"delivery":{}}'::jsonb,
       $2::jsonb, 'done', now())
     returning id`,
    [USERS.other, checkedLegacyContent],
  )
  const v2Attempt = await client.query(
    `insert into public.attempts (
       user_id, prompt_text, score, section_scores, content_result, status, finished_at
     ) values ($1, 'Versioned dispute snapshot', 80,
       '{"version":"v2.score.1","rubric_version":"v2"}'::jsonb,
       $2::jsonb, 'done', now())
     returning id`,
    [USERS.owner, checkedLegacyContent],
  )
  const ownerNote = await client.query(
    `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
     values ($1, $2, 'answered', null)
     returning id`,
    [USERS.owner, ownerAttempt.rows[0].id],
  )
  await client.query(
    `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
     values ($1, $2, 'answered', null)`,
    [USERS.other, otherAttempt.rows[0].id],
  )

  await setAuthenticatedUser(USERS.owner)
  try {
    const visible = await client.query('select id, user_id from public.note_feedback')
    assert(
      visible.rows.some((row) => row.id === ownerNote.rows[0].id) &&
        visible.rows.every((row) => row.user_id === USERS.owner),
      `${label}: authenticated note reads were not owner scoped`,
    )
    await expectPgError(
      () =>
        client.query(
          `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
           values ($1, $2, 'forged', 'browser write')`,
          [USERS.owner, ownerAttempt.rows[0].id],
        ),
      '42501',
      `${label}: authenticated note insert`,
    )
    await expectPgError(
      () =>
        client.query(`update public.note_feedback set note_type = 'forged' where id = $1`, [
          ownerNote.rows[0].id,
        ]),
      '42501',
      `${label}: authenticated note update`,
    )
    await expectPgError(
      () => client.query('delete from public.note_feedback where id = $1', [ownerNote.rows[0].id]),
      '42501',
      `${label}: authenticated note delete`,
    )
  } finally {
    await resetRole()
  }

  await client.query('set role anon')
  try {
    await expectPgError(
      () =>
        client.query(
          `insert into public.note_feedback (user_id, attempt_id, note_type)
           values ($1, $2, 'forged')`,
          [USERS.owner, ownerAttempt.rows[0].id],
        ),
      '42501',
      `${label}: anonymous note insert`,
    )
  } finally {
    await resetRole()
  }

  await client.query('set role service_role')
  try {
    const serviceInsert = await client.query(
      `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
       values ($1, $2, 'explained', 'exact stored quote')
       returning id`,
      [USERS.owner, ownerAttempt.rows[0].id],
    )
    assert(serviceInsert.rowCount === 1, `${label}: service-role note insert failed`)
    for (const invalid of [
      { noteType: 'logical_order', quote: null, attemptId: ownerAttempt.rows[0].id },
      { noteType: 'answered', quote: 'forged quote', attemptId: ownerAttempt.rows[0].id },
      { noteType: 'explained', quote: null, attemptId: ownerAttempt.rows[0].id },
      { noteType: 'word_choice_span', quote: 'forged span', attemptId: ownerAttempt.rows[0].id },
      { noteType: 'answered', quote: null, attemptId: v2Attempt.rows[0].id },
    ]) {
      await expectPgError(
        () =>
          client.query(
            `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
             values ($1, $2, $3, $4)`,
            [USERS.owner, invalid.attemptId, invalid.noteType, invalid.quote],
          ),
        '23514',
        `${label}: forged service-role note ${invalid.noteType}`,
      )
    }
    await expectPgError(
      () =>
        client.query(`update public.note_feedback set quote = 'forged quote' where id = $1`, [
          serviceInsert.rows[0].id,
        ]),
      '23514',
      `${label}: forged service-role note update`,
    )
    const serviceUpdate = await client.query(
      `update public.note_feedback
       set note_type = 'word_choice_span', quote = 'exact stored span'
       where id = $1
       returning id`,
      [serviceInsert.rows[0].id],
    )
    assert(serviceUpdate.rowCount === 1, `${label}: service-role note update failed`)
    const serviceDelete = await client.query(
      'delete from public.note_feedback where id = $1 returning id',
      [serviceInsert.rows[0].id],
    )
    assert(serviceDelete.rowCount === 1, `${label}: service-role note delete failed`)
    await expectPgError(
      () =>
        client.query(
          `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
           values ($1, $2, 'answered', null)`,
          [USERS.owner, ownerAttempt.rows[0].id],
        ),
      '23505',
      `${label}: exact duplicate note`,
    )
  } finally {
    await resetRole()
  }

  const snapshot = await client.query(
    'select score, section_scores, content_result from public.attempts where id = $1',
    [ownerAttempt.rows[0].id],
  )
  assert(
    snapshot.rows[0]?.score === ownerAttempt.rows[0].score &&
      JSON.stringify(snapshot.rows[0]?.section_scores) ===
        JSON.stringify(ownerAttempt.rows[0].section_scores) &&
      JSON.stringify(snapshot.rows[0]?.content_result) ===
        JSON.stringify(ownerAttempt.rows[0].content_result),
    `${label}: note writes changed the authoritative attempt snapshot`,
  )
}

async function assertLifecycleAndIdempotency(label) {
  const requestId = '40000000-0000-4000-8000-000000000004'
  await client.query(
    `insert into public.attempts (
       user_id, prompt_text, status, finished_at, score, section_scores, client_request_id
     ) values ($1, 'Partial result', 'done', now(), null, $2::jsonb, $3)`,
    [USERS.owner, JSON.stringify({ version: 'v2.score.1' }), requestId],
  )
  await expectPgError(
    () =>
      client.query(
        `insert into public.attempts (user_id, prompt_text, client_request_id)
         values ($1, 'Duplicate request', $2)`,
        [USERS.owner, requestId],
      ),
    '23505',
    `${label}: duplicate client request`,
  )
  await client.query(
    `insert into public.attempts (user_id, prompt_text, client_request_id)
     values ($1, 'Same request for another user', $2)`,
    [USERS.other, requestId],
  )

  const transition = await client.query(
    `insert into public.attempts (user_id, prompt_text)
     values ($1, 'Lifecycle transition')
     returning id`,
    [USERS.owner],
  )
  const id = transition.rows[0].id
  await client.query("update public.attempts set status = 'transcribing' where id = $1", [id])
  await client.query("update public.attempts set status = 'scoring' where id = $1", [id])
  await client.query("update public.attempts set status = 'done' where id = $1", [id])
  const completed = await client.query(
    'select status, status_changed_at, finished_at, score from public.attempts where id = $1',
    [id],
  )
  assert(completed.rows[0]?.status === 'done', `${label}: lifecycle did not reach done`)
  assert(completed.rows[0]?.status_changed_at, `${label}: status timestamp is missing`)
  assert(completed.rows[0]?.finished_at, `${label}: finished timestamp is missing`)
  assert(completed.rows[0]?.score === null, `${label}: done incorrectly requires a score`)

  await expectPgError(
    () => client.query("update public.attempts set status = 'scoring' where id = $1", [id]),
    '23514',
    `${label}: invalid terminal transition`,
  )

  const indexes = await client.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'attempts_user_created_idx',
        'attempts_user_practice_mode_created_idx',
        'attempts_retry_of_attempt_idx',
        'attempts_user_client_request_idx',
        'attempts_user_status_created_idx'
      )
  `)
  assert(indexes.rowCount === 5, `${label}: attempt indexes are missing`)

  const attemptFks = await client.query(`
    select conname, confdeltype
    from pg_constraint
    where conrelid = 'public.attempts'::regclass
      and contype = 'f'
    order by conname
  `)
  const deleteActions = Object.fromEntries(
    attemptFks.rows.map((row) => [row.conname, row.confdeltype]),
  )
  assert(deleteActions.attempts_user_id_fkey === 'c', `${label}: user FK must cascade`)
  assert(deleteActions.attempts_prompt_id_fkey === 'n', `${label}: prompt FK must set null`)
  assert(
    deleteActions.attempts_retry_of_attempt_id_fkey === 'n',
    `${label}: retry FK must set null`,
  )
  assert(
    deleteActions.attempts_lesson_id_fkey === 'r',
    `${label}: lesson FK must restrict deletion`,
  )

  const feedbackFks = await client.query(`
    select count(*)::integer as count
    from pg_constraint
    where conrelid = 'public.note_feedback'::regclass
      and contype = 'f'
      and confdeltype = 'c'
  `)
  assert(feedbackFks.rows[0]?.count === 2, `${label}: feedback cascade FKs are missing`)
}

const V2_CATEGORY_WEIGHTS = {
  practice: { fluency: 22, clarity: 20, vocabulary: 12, grammar: 12, structure: 18, delivery: 16 },
  interview: { fluency: 18, clarity: 22, vocabulary: 14, grammar: 12, structure: 22, delivery: 12 },
  presentation: {
    fluency: 16,
    clarity: 20,
    vocabulary: 14,
    grammar: 10,
    structure: 20,
    delivery: 20,
  },
  conversation: {
    fluency: 24,
    clarity: 22,
    vocabulary: 12,
    grammar: 12,
    structure: 14,
    delivery: 16,
  },
}

function allocateScore(maximums, score) {
  const entries = Object.entries(maximums)
  const raw = entries.map(([, maximum]) => (maximum * score) / 100)
  const earned = raw.map(Math.floor)
  let remaining = score - earned.reduce((sum, value) => sum + value, 0)
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  for (const item of order) {
    if (remaining <= 0) break
    earned[item.index] += 1
    remaining -= 1
  }
  return Object.fromEntries(entries.map(([category], index) => [category, earned[index]]))
}

function structuredScorePayload(mode, score, { extraCategory = false } = {}) {
  const maximums = V2_CATEGORY_WEIGHTS[mode]
  assert(maximums, `unsupported structured score mode: ${mode}`)
  const allocated = allocateScore(maximums, score)
  const categories = Object.fromEntries(
    Object.entries(maximums).map(([category, maximum]) => {
      const earned = allocated[category]
      return [
        category,
        {
          category,
          availability: 'available',
          status: 'scored',
          component: earned / maximum,
          earned_points: earned,
          max_points: maximum,
          measurements: {},
          evidence: [],
          deductions: [],
          warnings: [],
        },
      ]
    }),
  )
  if (extraCategory) {
    categories.forged = {
      category: 'forged',
      availability: 'available',
      status: 'scored',
      component: 0,
      earned_points: 0,
      max_points: 0,
      measurements: {},
      evidence: [],
      deductions: [],
      warnings: [],
    }
  }
  return {
    version: 'v2.score.1',
    rubric_version: 'v2',
    mode,
    total_earned_points: score,
    total_max_points: 100,
    categories,
    warnings: [],
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function malformedV2Payloads(mode, score) {
  const wrongWeights = cloneJson(structuredScorePayload(mode, score))
  wrongWeights.categories.fluency.max_points += 1
  wrongWeights.categories.clarity.max_points -= 1

  const missingFields = cloneJson(structuredScorePayload(mode, score))
  delete missingFields.categories.grammar.component

  const incoherentComponent = cloneJson(structuredScorePayload(mode, score))
  incoherentComponent.categories.structure.component = 0

  const offsetEarned = cloneJson(structuredScorePayload(mode, score))
  offsetEarned.categories.fluency.earned_points = -1
  offsetEarned.categories.fluency.component = -1 / offsetEarned.categories.fluency.max_points
  offsetEarned.categories.clarity.earned_points +=
    1 + structuredScorePayload(mode, score).categories.fluency.earned_points
  offsetEarned.categories.clarity.component =
    offsetEarned.categories.clarity.earned_points / offsetEarned.categories.clarity.max_points

  const malformedWarnings = cloneJson(structuredScorePayload(mode, score))
  malformedWarnings.categories.vocabulary.warnings = [42]

  const malformedEvidence = cloneJson(structuredScorePayload(mode, score))
  malformedEvidence.categories.delivery.evidence = [null]

  return [
    wrongWeights,
    missingFields,
    incoherentComponent,
    offsetEarned,
    malformedWarnings,
    malformedEvidence,
    structuredScorePayload(mode, score, { extraCategory: true }),
  ]
}

function activityV2Payload(mode, score, neutralCategory = null) {
  const payload = structuredScorePayload(mode, score ?? 0)
  const categories = Object.fromEntries(
    Object.entries(payload.categories).map(([category, value]) => [
      category,
      category === neutralCategory
        ? {
            ...value,
            availability: 'available',
            status: 'not_checked',
            component: null,
            earned_points: null,
            measurements: {},
            evidence: [],
            deductions: [],
            warnings: ['Provider result was unavailable.'],
          }
        : {
            ...value,
          },
    ]),
  )
  return { ...payload, total_earned_points: score, categories }
}

function legacyActivityPayload(score) {
  return {
    content: {
      earned: Math.max(0, score - 50),
      max: 50,
      checks: {
        answered: 14,
        explained: 12,
        word_choice: 12,
        logical_order: 7,
        no_repetition: 5,
      },
    },
    delivery: {
      earned: Math.min(50, score),
      max: 50,
      metrics: {
        fillers: 18,
        mid_sentence_pauses: 14,
        energy: 8,
        pace: 6,
        time_to_first_word: 4,
      },
    },
  }
}

async function assertActivitySecurity(label) {
  const schema = await client.query(`
    select
      (select count(*)::integer from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles' and column_name = 'timezone')
        as timezone_columns,
      (select count(*)::integer from information_schema.tables
       where table_schema = 'public' and table_name = 'practice_activity_days')
        as activity_tables
  `)
  assert(schema.rows[0]?.timezone_columns === 1, `${label}: profile timezone is missing`)
  assert(schema.rows[0]?.activity_tables === 1, `${label}: activity day table is missing`)

  const privileges = await client.query(`
    select privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'practice_activity_days'
      and grantee = 'authenticated'
    order by privilege_type
  `)
  assert(
    JSON.stringify(privileges.rows.map((row) => row.privilege_type)) === '["SELECT"]',
    `${label}: authenticated activity privileges must be SELECT only`,
  )
  const policies = await client.query(`
    select cmd from pg_policies
    where schemaname = 'public' and tablename = 'practice_activity_days'
  `)
  assert(
    JSON.stringify(policies.rows) === JSON.stringify([{ cmd: 'SELECT' }]),
    `${label}: activity owner policy changed`,
  )

  await client.query("update public.profiles set timezone = 'America/New_York' where id = $1", [
    USERS.owner,
  ])
  await expectPgError(
    () =>
      client.query("update public.profiles set timezone = 'Mars/Olympus' where id = $1", [
        USERS.owner,
      ]),
    '23514',
    `${label}: invalid profile timezone`,
  )
  await client.query(
    `insert into public.practice_activity_days (user_id, local_date, timezone)
     values ($1, '2030-01-01', 'America/New_York'), ($2, '2030-01-01', 'UTC')
     on conflict (user_id, local_date) do nothing`,
    [USERS.owner, USERS.other],
  )

  await setAuthenticatedUser(USERS.owner)
  try {
    const visible = await client.query(
      "select user_id from public.practice_activity_days where local_date = '2030-01-01'",
    )
    assert(
      JSON.stringify(visible.rows) === JSON.stringify([{ user_id: USERS.owner }]),
      `${label}: activity owner read leaked`,
    )
    await expectPgError(
      () =>
        client.query(
          `insert into public.practice_activity_days (user_id, local_date, timezone)
           values ($1, '2030-01-02', 'UTC')`,
          [USERS.owner],
        ),
      '42501',
      `${label}: browser forged an activity day`,
    )
  } finally {
    await resetRole()
  }
  await client.query("delete from public.practice_activity_days where local_date >= '2030-01-01'")
  await client.query('update public.profiles set timezone = null where id = $1', [USERS.owner])
}

async function assertCurriculumCoverage(label) {
  const counts = await client.query(`
    select
      (select count(*)::integer from public.practice_paths) as paths,
      (select count(*)::integer from public.practice_chapters) as chapters,
      (select count(*)::integer from public.practice_lessons) as lessons,
      (select count(*)::integer from public.prompts where not free_practice_visible) as curriculum_prompts,
      (select count(*)::integer from public.prompts where free_practice_visible) as free_prompts
  `)
  assert(counts.rows[0]?.paths === 4, `${label}: expected four curriculum paths`)
  assert(counts.rows[0]?.chapters === 12, `${label}: expected twelve curriculum chapters`)
  assert(counts.rows[0]?.lessons === 120, `${label}: expected 120 curriculum lessons`)
  assert(
    counts.rows[0]?.curriculum_prompts === 120,
    `${label}: expected 120 curriculum-only prompts`,
  )
  assert(counts.rows[0]?.free_prompts === 60, `${label}: existing Free Practice prompts changed`)

  const invalidChapters = await client.query(`
    select chapter.id
    from public.practice_chapters as chapter
    left join public.practice_lessons as lesson on lesson.chapter_id = chapter.id
    group by chapter.id
    having count(lesson.id) <> 10
      or count(*) filter (where lesson.checkpoint) <> 1
      or max(lesson.position) filter (where lesson.checkpoint) <> 10
  `)
  assert(
    invalidChapters.rowCount === 0,
    `${label}: chapter lesson or checkpoint distribution failed`,
  )

  const pathModes = await client.query(`
    select slug, mode, position
    from public.practice_paths
    order by position
  `)
  assert(
    JSON.stringify(pathModes.rows) ===
      JSON.stringify([
        { slug: 'general-speaking', mode: 'practice', position: 1 },
        { slug: 'interviews', mode: 'interview', position: 2 },
        { slug: 'presentations', mode: 'presentation', position: 3 },
        { slug: 'conversations', mode: 'conversation', position: 4 },
      ]),
    `${label}: path slug or mode mapping changed`,
  )
  assert(
    pathModes.rows[0] &&
      (await client.query("select id from public.practice_paths where slug = 'general-speaking'"))
        .rows[0]?.id === 'ebaec575-9889-5d28-8a23-8b54fae728db',
    `${label}: deterministic General Speaking id changed`,
  )

  const lessonSlugs = await client.query(`
    select count(*)::integer as total,
      count(distinct slug)::integer as distinct_slugs,
      bool_and(slug ~ '^(general-speaking|interviews|presentations|conversations)-(beginner|intermediate|advanced)-[0-9]{2}-[a-z0-9-]+$') as valid
    from public.practice_lessons
  `)
  assert(
    lessonSlugs.rows[0]?.total === 120 &&
      lessonSlugs.rows[0]?.distinct_slugs === 120 &&
      lessonSlugs.rows[0]?.valid === true,
    `${label}: lesson slugs are not globally stable`,
  )
}

async function assertCurriculumSecurity(label) {
  const preferencePrivileges = await client.query(`
    select privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'profile_path_preferences'
      and grantee = 'authenticated'
    order by privilege_type
  `)
  assert(
    JSON.stringify(preferencePrivileges.rows.map((row) => row.privilege_type)) === '["SELECT"]',
    `${label}: preferences must expose only SELECT table privileges`,
  )
  const progressPrivileges = await client.query(`
    select privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'lesson_progress'
      and grantee = 'authenticated'
    order by privilege_type
  `)
  assert(
    JSON.stringify(progressPrivileges.rows.map((row) => row.privilege_type)) === '["SELECT"]',
    `${label}: lesson progress must expose only SELECT`,
  )

  const policies = await client.query(`
    select tablename, cmd
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profile_path_preferences', 'lesson_progress')
    order by tablename, cmd
  `)
  assert(
    JSON.stringify(policies.rows) ===
      JSON.stringify([
        { tablename: 'lesson_progress', cmd: 'SELECT' },
        { tablename: 'profile_path_preferences', cmd: 'DELETE' },
        { tablename: 'profile_path_preferences', cmd: 'INSERT' },
        { tablename: 'profile_path_preferences', cmd: 'SELECT' },
        { tablename: 'profile_path_preferences', cmd: 'UPDATE' },
      ]),
    `${label}: curriculum owner policies changed`,
  )

  const paths = await client.query(
    `select id, slug from public.practice_paths
     where slug in ('general-speaking', 'interviews', 'presentations') order by slug`,
  )
  const general = paths.rows.find((row) => row.slug === 'general-speaking')
  const interviews = paths.rows.find((row) => row.slug === 'interviews')
  const presentations = paths.rows.find((row) => row.slug === 'presentations')
  assert(general && interviews && presentations, `${label}: preference test paths are missing`)
  await client.query('update public.practice_paths set active = false where id = $1', [
    presentations.id,
  ])

  await setAuthenticatedUser(USERS.owner)
  try {
    await client.query('select public.replace_profile_path_preferences($1::uuid[])', [
      [interviews.id, general.id],
    ])
    const ownPreferences = await client.query(
      'select user_id, path_id, rank from public.profile_path_preferences order by rank',
    )
    assert(
      JSON.stringify(ownPreferences.rows) ===
        JSON.stringify([
          { user_id: USERS.owner, path_id: interviews.id, rank: 0 },
          { user_id: USERS.owner, path_id: general.id, rank: 1 },
        ]),
      `${label}: atomic preference replacement failed`,
    )
    await expectPgError(
      () =>
        client.query('select public.replace_profile_path_preferences($1::uuid[])', [
          [general.id, general.id],
        ]),
      '23514',
      `${label}: duplicate atomic preferences`,
    )
    await expectPgError(
      () =>
        client.query('select public.replace_profile_path_preferences($1::uuid[])', [
          [presentations.id],
        ]),
      '23514',
      `${label}: inactive atomic preference`,
    )
    await expectPgError(
      () =>
        client.query(
          `insert into public.profile_path_preferences (user_id, path_id, rank)
           values ($1, $2, 2)`,
          [USERS.owner, general.id],
        ),
      '42501',
      `${label}: direct authenticated preference insert`,
    )
  } finally {
    await resetRole()
    await client.query('update public.practice_paths set active = true where id = $1', [
      presentations.id,
    ])
  }

  const lesson = await client.query(`
    select lesson.id, lesson.prompt_id, path.mode
    from public.practice_lessons as lesson
    join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
    join public.practice_paths as path on path.id = chapter.path_id
    where path.slug = 'general-speaking'
    order by chapter.position, lesson.position
    limit 1
  `)
  const target = lesson.rows[0]
  assert(target, `${label}: progress test lesson is missing`)

  const incomplete = await client.query(
    `insert into public.attempts (
       user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
       prompt_difficulty, rubric_version, status, finished_at, score, section_scores
     ) values ($1, $2, $3, 'Provider incomplete snapshot', $4, 'library', 'beginner',
       'v2', 'done', '2026-08-28T10:00:00Z', null, $5::jsonb)
     returning id`,
    [
      USERS.owner,
      target.prompt_id,
      target.id,
      target.mode,
      JSON.stringify({
        ...structuredScorePayload(target.mode, 0),
        total_earned_points: null,
      }),
    ],
  )
  const afterIncomplete = await client.query(
    'select count(*)::integer as count from public.lesson_progress where user_id = $1 and lesson_id = $2',
    [USERS.owner, target.id],
  )
  assert(afterIncomplete.rows[0]?.count === 0, `${label}: unavailable score created progress`)

  const attempts = []
  for (const [score, finishedAt] of [
    [72, '2026-08-28T10:01:00Z'],
    [65, '2026-08-28T10:02:00Z'],
    [72, '2026-08-28T10:03:00Z'],
  ]) {
    const attempt = await client.query(
      `insert into public.attempts (
         user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
         prompt_difficulty, rubric_version, status, finished_at, score, section_scores
       ) values ($1, $2, $3, 'Structured snapshot', $4, 'library', 'beginner',
         'v2', 'done', $5::timestamptz, $6, $7::jsonb)
       returning id`,
      [
        USERS.owner,
        target.prompt_id,
        target.id,
        target.mode,
        finishedAt,
        score,
        JSON.stringify(structuredScorePayload(target.mode, score)),
      ],
    )
    attempts.push({ id: attempt.rows[0].id, score })
  }

  const tiedBest = await client.query(
    'select best_score, best_attempt_id from public.lesson_progress where user_id = $1 and lesson_id = $2',
    [USERS.owner, target.id],
  )
  assert(
    tiedBest.rows[0]?.best_score === 72 && tiedBest.rows[0]?.best_attempt_id === attempts[2].id,
    `${label}: equal score did not prefer the newest completion`,
  )

  const higherAttempt = await client.query(
    `insert into public.attempts (
       user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
       prompt_difficulty, rubric_version, status, finished_at, score, section_scores
     ) values ($1, $2, $3, 'Higher structured snapshot', $4, 'library', 'beginner',
       'v2', 'done', '2026-08-28T10:04:00Z', 80, $5::jsonb)
     returning id`,
    [
      USERS.owner,
      target.prompt_id,
      target.id,
      target.mode,
      JSON.stringify(structuredScorePayload(target.mode, 80)),
    ],
  )
  attempts.push({ id: higherAttempt.rows[0].id, score: 80 })

  const best = await client.query(
    'select best_score, best_attempt_id from public.lesson_progress where user_id = $1 and lesson_id = $2',
    [USERS.owner, target.id],
  )
  assert(
    best.rows[0]?.best_score === 80 && best.rows[0]?.best_attempt_id === attempts[3].id,
    `${label}: higher score did not become the durable best`,
  )
  await expectPgError(
    () =>
      client.query(
        'update public.lesson_progress set best_score = 70 where user_id = $1 and lesson_id = $2',
        [USERS.owner, target.id],
      ),
    '23514',
    `${label}: direct best-score regression guard`,
  )

  for (const [index, payload] of malformedV2Payloads(target.mode, 90).entries()) {
    const malformedAttempt = await client.query(
      `insert into public.attempts (
         user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
         prompt_difficulty, rubric_version, status, finished_at, score, section_scores
       ) values ($1, $2, $3, 'Malformed structured snapshot', $4, 'library', 'beginner',
         'v2', 'done', $5::timestamptz, 90, $6::jsonb)
       returning id`,
      [
        USERS.other,
        target.prompt_id,
        target.id,
        target.mode,
        `2026-08-28T10:${String(index + 5).padStart(2, '0')}:00Z`,
        JSON.stringify(payload),
      ],
    )
    const malformedProgress = await client.query(
      'select count(*)::integer as count from public.lesson_progress where best_attempt_id = $1',
      [malformedAttempt.rows[0].id],
    )
    assert(
      malformedProgress.rows[0]?.count === 0,
      `${label}: malformed payload ${index + 1} raised progress`,
    )
  }

  const nullScoreAttempt = await client.query(
    `insert into public.attempts (
       user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
       prompt_difficulty, rubric_version, status, finished_at, score, section_scores
     ) values ($1, $2, $3, 'Structured snapshot without attempt score', $4, 'library',
       'beginner', 'v2', 'done', '2026-08-28T10:20:00Z', null, $5::jsonb)
     returning id`,
    [
      USERS.other,
      target.prompt_id,
      target.id,
      target.mode,
      JSON.stringify(structuredScorePayload(target.mode, 90)),
    ],
  )
  const nullScoreProgress = await client.query(
    'select count(*)::integer as count from public.lesson_progress where best_attempt_id = $1',
    [nullScoreAttempt.rows[0].id],
  )
  assert(
    nullScoreProgress.rows[0]?.count === 0,
    `${label}: scored payload without attempt score raised progress`,
  )

  await client.query('delete from public.attempts where id = $1', [attempts[3].id])
  const afterDelete = await client.query(
    'select best_score, best_attempt_id from public.lesson_progress where user_id = $1 and lesson_id = $2',
    [USERS.owner, target.id],
  )
  assert(
    afterDelete.rows[0]?.best_score === 80 && afterDelete.rows[0]?.best_attempt_id === null,
    `${label}: deleting a best attempt erased achievement`,
  )

  await setAuthenticatedUser(USERS.owner)
  try {
    await expectPgError(
      () =>
        client.query(
          `insert into public.lesson_progress (user_id, lesson_id, best_score)
           values ($1, $2, 100)`,
          [USERS.owner, target.id],
        ),
      '42501',
      `${label}: authenticated progress forgery`,
    )
    const visible = await client.query('select user_id from public.lesson_progress')
    assert(
      visible.rows.every((row) => row.user_id === USERS.owner),
      `${label}: lesson progress owner read leaked`,
    )
  } finally {
    await resetRole()
  }

  await client.query('delete from public.attempts where id = $1', [incomplete.rows[0].id])
}

async function reapplyCurriculumData(migrations, label) {
  const seed = migrations.find(({ name }) => name === 'curriculum_seed')
  const backfill = migrations.find(({ name }) => name === 'path_preferences_backfill')
  assert(seed && backfill, `${label}: curriculum data migrations are missing`)
  await applyMigration(client, seed)
  await applyMigration(client, backfill)
  await assertCurriculumCoverage(`${label} reapplied`)
}

async function runFresh(migrations) {
  await bootstrapSupabaseSurface()
  await seedAuthUser(USERS.missingProfile, 'Backfilled Fresh')
  await seedAuthUser(USERS.owner, 'Fresh Owner')
  await seedAuthUser(USERS.other, 'Fresh Other')
  await applyAll(migrations)
  await reapplyStorageHardening(migrations, 'fresh')

  const profiles = await client.query('select id from public.profiles order by id')
  assert(profiles.rowCount === 3, 'fresh: existing auth users were not backfilled')
  await assertPromptCoverage('fresh')
  await assertLifecycleAndIdempotency('fresh')
  await assertAttemptSecurity('fresh')
  await assertNoteFeedbackSecurity('fresh')
  await assertCurriculumCoverage('fresh')
  await assertCurriculumSecurity('fresh')
  await assertActivitySecurity('fresh')
  await reapplyCurriculumData(migrations, 'fresh')
  console.log('pass fresh migration chain')
}

async function runUpgrade(migrations) {
  await bootstrapSupabaseSurface()
  await seedAuthUser(USERS.missingProfile, 'Backfilled Upgrade')
  await applyAll(migrations.slice(0, 4))
  await seedAuthUser(USERS.owner, 'Preserve Owner')
  await seedAuthUser(USERS.other, 'Upgrade Other')
  await client.query(
    `update public.profiles set display_name = 'Existing Profile Value' where id = $1`,
    [USERS.owner],
  )

  const prompt = await client.query('select id from public.prompts order by created_at limit 1')
  const legacyDone = await client.query(
    `insert into public.attempts (
       user_id, prompt_id, prompt_text, transcript, duration_ms, score,
       section_scores, metrics, content_result, created_at
     ) values ($1, $2, 'Legacy prompt snapshot', 'Legacy transcript', 42000, 73,
       $3::jsonb, $4::jsonb, $5::jsonb, $6::timestamptz)
     returning id`,
    [
      USERS.owner,
      prompt.rows[0].id,
      JSON.stringify({ content: 35, delivery: 38 }),
      JSON.stringify({ capture: { duration_ms: 42000 } }),
      JSON.stringify({ status: 'completed' }),
      LEGACY_CREATED_AT,
    ],
  )
  const legacyIncomplete = await client.query(
    `insert into public.attempts (user_id, prompt_text, transcript, duration_ms)
     values ($1, 'Interrupted prompt snapshot', 'Preserve this transcript', 17000)
     returning id`,
    [USERS.owner],
  )

  await applyAll(migrations.slice(4, 6))
  const partial = await client.query(
    `insert into public.attempts (
       user_id, prompt_text, score, section_scores, practice_mode, rubric_version
     ) values ($1, 'Partial v2 snapshot', null, $2::jsonb, 'practice', 'v2')
     returning id`,
    [USERS.owner, JSON.stringify({ version: 'v2.score.1', total_earned_points: null })],
  )
  const historicalDisputeAttempt = await client.query(
    `insert into public.attempts (
       user_id, prompt_text, score, section_scores, content_result
     ) values ($1, 'Historical dispute snapshot', 65,
       '{"content":{},"delivery":{}}'::jsonb,
       $2::jsonb)
     returning id`,
    [
      USERS.owner,
      JSON.stringify({
        status: 'checked',
        checks: {
          answered: { passed: false, quote: null },
          explained: { passed: true, quote: null },
        },
        extra_spans: [{ text: 'kind of useful', category: 'imprecise' }],
      }),
    ],
  )

  await setAuthenticatedUser(USERS.owner)
  try {
    await client.query(
      `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
       values
         ($1, $2, 'answered', null),
         ($1, $2, 'answered', null),
         ($1, $2, 'answered', 'forged quote'),
         ($1, $2, 'explained', null),
         ($1, $2, 'word_choice_span', 'kind of useful'),
         ($1, $2, 'word_choice_span', 'forged span'),
         ($1, $3, 'answered', null)`,
      [USERS.owner, historicalDisputeAttempt.rows[0].id, partial.rows[0].id],
    )
  } finally {
    await resetRole()
  }
  await applyAll(migrations.slice(6))
  await reapplyStorageHardening(migrations, 'upgrade')

  const deduplicatedNotes = await client.query(
    `select note_type, quote, count(*)::integer as count
     from public.note_feedback
     where user_id = $1 and attempt_id = $2
     group by note_type, quote
     order by note_type, quote`,
    [USERS.owner, historicalDisputeAttempt.rows[0].id],
  )
  assert(
    JSON.stringify(deduplicatedNotes.rows) ===
      JSON.stringify([
        { note_type: 'answered', quote: null, count: 1 },
        { note_type: 'word_choice_span', quote: 'kind of useful', count: 1 },
      ]),
    'upgrade: invalid or duplicate historical notes were not repaired',
  )
  const v2Notes = await client.query(
    'select count(*)::integer as count from public.note_feedback where attempt_id = $1',
    [partial.rows[0].id],
  )
  assert(v2Notes.rows[0]?.count === 0, 'upgrade: a historical v2-linked dispute was retained')

  const preserved = await client.query(
    `select id, prompt_text, transcript, duration_ms, score, section_scores, metrics,
       content_result, created_at, status, failure_code, status_changed_at, finished_at
     from public.attempts
     where id = any($1::uuid[])
     order by id`,
    [[legacyDone.rows[0].id, legacyIncomplete.rows[0].id, partial.rows[0].id]],
  )
  const done = preserved.rows.find((row) => row.id === legacyDone.rows[0].id)
  const incomplete = preserved.rows.find((row) => row.id === legacyIncomplete.rows[0].id)
  const partialResult = preserved.rows.find((row) => row.id === partial.rows[0].id)
  assert(done?.status === 'done' && done.score === 73, 'upgrade: legacy result was not preserved')
  assert(
    done.prompt_text === 'Legacy prompt snapshot' && done.transcript === 'Legacy transcript',
    'upgrade: legacy prompt or transcript snapshot changed',
  )
  assert(
    done.created_at.toISOString() === LEGACY_CREATED_AT &&
      done.status_changed_at.toISOString() === LEGACY_CREATED_AT &&
      done.finished_at.toISOString() === LEGACY_CREATED_AT,
    'upgrade: historical lifecycle timestamps did not preserve created_at',
  )
  assert(
    incomplete?.status === 'timed_out' && incomplete.failure_code === 'legacy_incomplete',
    'upgrade: incomplete legacy row was misclassified',
  )
  assert(
    incomplete.transcript === 'Preserve this transcript',
    'upgrade: incomplete transcript was not preserved',
  )
  assert(
    partialResult?.status === 'done' && partialResult.score === null,
    'upgrade: partial v2 result was not completed with a nullable score',
  )

  const profiles = await client.query(
    'select id, display_name from public.profiles where id = any($1::uuid[]) order by id',
    [[USERS.missingProfile, USERS.owner, USERS.other]],
  )
  assert(profiles.rowCount === 3, 'upgrade: missing profile was not backfilled')
  assert(
    profiles.rows.find((row) => row.id === USERS.owner)?.display_name === 'Existing Profile Value',
    'upgrade: existing profile was overwritten',
  )

  await assertPromptCoverage('upgrade')
  await assertLifecycleAndIdempotency('upgrade')
  await assertAttemptSecurity('upgrade')
  await assertNoteFeedbackSecurity('upgrade')
  await assertCurriculumCoverage('upgrade')
  await assertCurriculumSecurity('upgrade')
  await assertActivitySecurity('upgrade')
  console.log('pass original-four upgrade chain')
}

async function runPreCurriculumUpgrade(migrations) {
  await bootstrapSupabaseSurface()
  const preCurriculum = migrations.slice(0, 9)
  const curriculum = migrations.slice(9, 12)
  const phase5 = migrations.slice(12)
  assert(
    preCurriculum.at(-1)?.name === 'note_feedback_write_boundary',
    'pre-curriculum boundary must include all nine production migrations',
  )
  assert(
    JSON.stringify(curriculum.map(({ name }) => name)) ===
      JSON.stringify(['curriculum_schema', 'curriculum_seed', 'path_preferences_backfill']),
    'expected exactly three curriculum migrations after the production boundary',
  )
  assert(
    JSON.stringify(phase5.map(({ name }) => name)) === JSON.stringify(['practice_activity']),
    'expected exactly one Phase 5 activity migration',
  )

  await applyAll(preCurriculum)
  await seedAuthUser(USERS.missingProfile, 'Pre-curriculum General')
  await seedAuthUser(USERS.owner, 'Pre-curriculum Owner')
  await seedAuthUser(USERS.other, 'Pre-curriculum Other')
  const ownerFocusAreas = [
    'general-speaking',
    'meetings',
    'interviews',
    'difficult-conversations',
    'presentations',
  ]
  const otherFocusAreas = ['unknown-future-focus']
  await client.query('update public.profiles set focus_areas = $2 where id = $1', [
    USERS.owner,
    ownerFocusAreas,
  ])
  await client.query('update public.profiles set focus_areas = $2 where id = $1', [
    USERS.other,
    otherFocusAreas,
  ])

  const existingPrompt = await client.query(`
    select id, text, mode, difficulty, target_duration_seconds, collection_id
    from public.prompts
    order by created_at, id
    limit 1
  `)
  const snapshot = {
    sectionScores: { version: 'v2.score.1', preserved: true },
    metrics: { capture: { duration_ms: 42000 }, preserved: true },
    contentResult: { status: 'checked', preserved: true },
  }
  const existingAttempt = await client.query(
    `insert into public.attempts (
       user_id, prompt_id, prompt_text, transcript, duration_ms, score,
       section_scores, metrics, content_result, practice_mode, prompt_source,
       prompt_difficulty, rubric_version, status, finished_at, created_at
     ) values ($1, $2, 'Immutable pre-curriculum prompt', 'Immutable pre-curriculum transcript',
       42000, 73, $3::jsonb, $4::jsonb, $5::jsonb, 'practice', 'library',
       'beginner', 'v2', 'done', $6::timestamptz, $6::timestamptz)
     returning id`,
    [
      USERS.owner,
      existingPrompt.rows[0].id,
      JSON.stringify(snapshot.sectionScores),
      JSON.stringify(snapshot.metrics),
      JSON.stringify(snapshot.contentResult),
      LEGACY_CREATED_AT,
    ],
  )
  const before = await client.query(`
    select
      (select count(*)::integer from public.profiles) as profiles,
      (select count(*)::integer from public.prompts) as prompts,
      (select count(*)::integer from public.attempts) as attempts
  `)

  await applyAll(curriculum)

  const after = await client.query(`
    select
      (select count(*)::integer from public.profiles) as profiles,
      (select count(*)::integer from public.prompts where free_practice_visible) as free_prompts,
      (select count(*)::integer from public.attempts) as attempts
  `)
  assert(after.rows[0]?.profiles === before.rows[0]?.profiles, 'pre-curriculum: users changed')
  assert(
    after.rows[0]?.free_prompts === before.rows[0]?.prompts,
    'pre-curriculum: existing prompts stopped being Free Practice-visible',
  )
  assert(after.rows[0]?.attempts === before.rows[0]?.attempts, 'pre-curriculum: attempts changed')

  const preservedAttempt = await client.query(
    `select prompt_id, lesson_id, prompt_text, transcript, duration_ms, score,
       section_scores, metrics, content_result, created_at, finished_at
     from public.attempts where id = $1`,
    [existingAttempt.rows[0].id],
  )
  const preserved = preservedAttempt.rows[0]
  assert(preserved?.lesson_id === null, 'pre-curriculum: old attempt gained a lesson id')
  assert(
    preserved.prompt_id === existingPrompt.rows[0].id &&
      preserved.prompt_text === 'Immutable pre-curriculum prompt' &&
      preserved.transcript === 'Immutable pre-curriculum transcript' &&
      preserved.duration_ms === 42000 &&
      preserved.score === 73 &&
      JSON.stringify(preserved.section_scores) === JSON.stringify(snapshot.sectionScores) &&
      JSON.stringify(preserved.metrics) === JSON.stringify(snapshot.metrics) &&
      JSON.stringify(preserved.content_result) === JSON.stringify(snapshot.contentResult) &&
      preserved.created_at.toISOString() === LEGACY_CREATED_AT &&
      preserved.finished_at.toISOString() === LEGACY_CREATED_AT,
    'pre-curriculum: historical attempt snapshot changed',
  )
  const preservedPrompt = await client.query(
    `select text, mode, difficulty, target_duration_seconds, collection_id, free_practice_visible
     from public.prompts where id = $1`,
    [existingPrompt.rows[0].id],
  )
  assert(
    JSON.stringify(preservedPrompt.rows[0]) ===
      JSON.stringify({ ...existingPrompt.rows[0], id: undefined, free_practice_visible: true }),
    'pre-curriculum: existing prompt metadata changed',
  )

  const ownerPreferences = await client.query(
    `
    select path.slug, preference.rank
    from public.profile_path_preferences as preference
    join public.practice_paths as path on path.id = preference.path_id
    where preference.user_id = $1
    order by preference.rank
  `,
    [USERS.owner],
  )
  assert(
    JSON.stringify(ownerPreferences.rows) ===
      JSON.stringify([
        { slug: 'interviews', rank: 0 },
        { slug: 'presentations', rank: 1 },
        { slug: 'conversations', rank: 2 },
        { slug: 'general-speaking', rank: 3 },
      ]),
    'pre-curriculum: canonical preference backfill changed',
  )
  const otherPreferences = await client.query(
    `
    select path.slug, preference.rank
    from public.profile_path_preferences as preference
    join public.practice_paths as path on path.id = preference.path_id
    where preference.user_id = $1
  `,
    [USERS.other],
  )
  assert(
    JSON.stringify(otherPreferences.rows) ===
      JSON.stringify([{ slug: 'general-speaking', rank: 0 }]),
    'pre-curriculum: unknown focus did not map to General Speaking',
  )
  const focusAreas = await client.query(
    'select id, focus_areas from public.profiles where id = any($1::uuid[]) order by id',
    [[USERS.owner, USERS.other]],
  )
  assert(
    JSON.stringify(focusAreas.rows.find((row) => row.id === USERS.owner)?.focus_areas) ===
      JSON.stringify(ownerFocusAreas) &&
      JSON.stringify(focusAreas.rows.find((row) => row.id === USERS.other)?.focus_areas) ===
        JSON.stringify(otherFocusAreas),
    'pre-curriculum: historical focus areas were rewritten',
  )

  await seedAuthUser(USERS.signedUpAfterCurriculum, 'New Curriculum User')
  const signupFoundation = await client.query(
    `
    select path.slug, preference.rank
    from public.profile_path_preferences as preference
    join public.practice_paths as path on path.id = preference.path_id
    where preference.user_id = $1
  `,
    [USERS.signedUpAfterCurriculum],
  )
  assert(
    JSON.stringify(signupFoundation.rows) ===
      JSON.stringify([{ slug: 'general-speaking', rank: 0 }]),
    'pre-curriculum: signup did not receive the General Speaking foundation',
  )

  await assertPromptCoverage('pre-curriculum')
  await assertCurriculumCoverage('pre-curriculum')
  await assertLifecycleAndIdempotency('pre-curriculum')
  await assertAttemptSecurity('pre-curriculum')
  await assertCurriculumSecurity('pre-curriculum')
  await reapplyCurriculumData(migrations, 'pre-curriculum')
  await applyAll(phase5)
  await assertActivitySecurity('pre-curriculum')
  console.log('pass nine-migration pre-curriculum upgrade chain')
}

async function runPrePhase5Upgrade(migrations) {
  await bootstrapSupabaseSurface()
  const prePhase5 = migrations.slice(0, 12)
  const phase5 = migrations.slice(12)
  assert(
    prePhase5.at(-1)?.name === 'path_preferences_backfill',
    'pre-Phase-5 boundary must include the curriculum preference backfill',
  )
  assert(
    JSON.stringify(phase5.map(({ name }) => name)) === JSON.stringify(['practice_activity']),
    'pre-Phase-5 upgrade must add only practice activity',
  )

  await applyAll(prePhase5)
  await seedAuthUser(USERS.owner, 'Pre-Phase-5 Owner')
  await seedAuthUser(USERS.other, 'Pre-Phase-5 Other')
  const attempts = await client.query(
    `insert into public.attempts (
       user_id, prompt_text, transcript, duration_ms, score, section_scores,
       practice_mode, rubric_version, status, finished_at, created_at
     ) values
       ($1, 'Below pass threshold', 'Valid response one', 30000, 64, $2::jsonb,
        'practice', null, 'done', '2026-08-27T23:30:00Z', '2026-08-27T23:30:00Z'),
       ($1, 'Provider incomplete', 'Valid response two', 30000, null, $3::jsonb,
        'practice', 'v2', 'done', '2026-08-28T00:30:00Z', '2026-08-28T00:30:00Z'),
       ($1, 'Same day scored response', 'Valid response three', 30000, 84, $4::jsonb,
        'practice', 'v2', 'done', '2026-08-28T12:30:00Z', '2026-08-28T12:30:00Z'),
       ($1, 'Failed response', 'Not activity', 30000, null, null,
        'practice', 'v2', 'failed', '2026-08-29T00:30:00Z', '2026-08-29T00:30:00Z')
     returning id`,
    [
      USERS.owner,
      JSON.stringify(legacyActivityPayload(64)),
      JSON.stringify(activityV2Payload('practice', null, 'grammar')),
      JSON.stringify(activityV2Payload('practice', 84)),
    ],
  )
  const attemptIds = attempts.rows.map((row) => row.id)
  for (const [index, payload] of malformedV2Payloads('practice', 90).entries()) {
    const malformed = await client.query(
      `insert into public.attempts (
         user_id, prompt_text, transcript, duration_ms, score, section_scores,
         practice_mode, rubric_version, status, finished_at, created_at
       ) values ($1, 'Malformed historical response', 'Malformed result', 30000, 90,
         $2::jsonb, 'practice', 'v2', 'done', $3::timestamptz, $3::timestamptz)
       returning id`,
      [
        USERS.owner,
        JSON.stringify(payload),
        `2026-09-${String(index + 1).padStart(2, '0')}T00:30:00Z`,
      ],
    )
    attemptIds.push(malformed.rows[0].id)
  }

  await applyAll(phase5)
  const backfilled = await client.query(
    `select local_date::text, timezone
     from public.practice_activity_days
     where user_id = $1 order by local_date`,
    [USERS.owner],
  )
  assert(
    JSON.stringify(backfilled.rows) ===
      JSON.stringify([
        { local_date: '2026-08-27', timezone: 'UTC' },
        { local_date: '2026-08-28', timezone: 'UTC' },
      ]),
    'pre-Phase-5: conservative UTC activity backfill changed',
  )
  await client.query('delete from public.attempts where id = any($1::uuid[])', [attemptIds])
  const afterDelete = await client.query(
    'select count(*)::integer as count from public.practice_activity_days where user_id = $1',
    [USERS.owner],
  )
  assert(afterDelete.rows[0]?.count === 2, 'pre-Phase-5: attempt deletion erased activity')
  await assertActivitySecurity('pre-Phase-5')
  console.log('pass exact pre-Phase-5 upgrade chain')
}

try {
  await client.connect()
  const migrations = loadMigrations()
  assert(
    migrations.length === 13,
    'Expected nine production, three curriculum, and one Phase 5 migration.',
  )
  await runFresh(migrations)
  await runUpgrade(migrations)
  await runPreCurriculumUpgrade(migrations)
  await runPrePhase5Upgrade(migrations)
  console.log('Migration integration harness passed.')
} catch (error) {
  console.error(`Migration integration harness failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
