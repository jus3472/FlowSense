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

async function assertPromptCoverage(label) {
  const summary = await client.query(`
    select count(*)::integer as total,
      count(distinct (mode, difficulty))::integer as combinations
    from public.prompts
    where active
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

    await client.query(
      `insert into storage.objects (bucket_id, name)
       values ('recordings', $1)`,
      [`${USERS.owner}/owned.webm`],
    )
    const storageRows = await client.query('select name from storage.objects')
    assert(storageRows.rowCount === 1, `${label}: owner storage read or upload failed`)
  } finally {
    await resetRole()
  }

  await client.query(
    `insert into storage.objects (bucket_id, name)
     values ('recordings', $1)`,
    [`${USERS.other}/other.webm`],
  )
  await setAuthenticatedUser(USERS.owner)
  try {
    const storageRows = await client.query('select name from storage.objects')
    assert(
      storageRows.rows.every((row) => row.name.startsWith(`${USERS.owner}/`)),
      `${label}: owner could read another user's recording`,
    )
  } finally {
    await resetRole()
  }
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

  const feedbackFks = await client.query(`
    select count(*)::integer as count
    from pg_constraint
    where conrelid = 'public.note_feedback'::regclass
      and contype = 'f'
      and confdeltype = 'c'
  `)
  assert(feedbackFks.rows[0]?.count === 2, `${label}: feedback cascade FKs are missing`)
}

async function runFresh(migrations) {
  await bootstrapSupabaseSurface()
  await seedAuthUser(USERS.missingProfile, 'Backfilled Fresh')
  await seedAuthUser(USERS.owner, 'Fresh Owner')
  await seedAuthUser(USERS.other, 'Fresh Other')
  await applyAll(migrations)

  const profiles = await client.query('select id from public.profiles order by id')
  assert(profiles.rowCount === 3, 'fresh: existing auth users were not backfilled')
  await assertPromptCoverage('fresh')
  await assertLifecycleAndIdempotency('fresh')
  await assertAttemptSecurity('fresh')
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
       section_scores, metrics, content_result
     ) values ($1, $2, 'Legacy prompt snapshot', 'Legacy transcript', 42000, 73,
       $3::jsonb, $4::jsonb, $5::jsonb)
     returning id`,
    [
      USERS.owner,
      prompt.rows[0].id,
      JSON.stringify({ content: 35, delivery: 38 }),
      JSON.stringify({ capture: { duration_ms: 42000 } }),
      JSON.stringify({ status: 'completed' }),
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
  await applyAll(migrations.slice(6))

  const preserved = await client.query(
    `select id, prompt_text, transcript, duration_ms, score, section_scores, metrics,
       content_result, status, failure_code, finished_at
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
  console.log('pass original-four upgrade chain')
}

try {
  await client.connect()
  const migrations = loadMigrations()
  assert(migrations.length >= 7, 'Expected the full migration chain including the foundation.')
  await runFresh(migrations)
  await runUpgrade(migrations)
  console.log('Migration integration harness passed.')
} catch (error) {
  console.error(`Migration integration harness failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
