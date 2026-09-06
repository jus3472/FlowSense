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
  hardeningSignup: '90000000-0000-4000-8000-000000000009',
  progression: 'a0000000-0000-4000-8000-00000000000a',
  deletion: 'b0000000-0000-4000-8000-00000000000b',
  deletionOther: 'c0000000-0000-4000-8000-00000000000c',
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

const HARDENED_TABLE_PRIVILEGES = {
  practice_paths: {
    anon: ['SELECT'],
    authenticated: ['SELECT'],
    service_role: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  },
  practice_chapters: {
    anon: ['SELECT'],
    authenticated: ['SELECT'],
    service_role: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  },
  practice_lessons: {
    anon: ['SELECT'],
    authenticated: ['SELECT'],
    service_role: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  },
  profile_path_preferences: {
    anon: [],
    authenticated: ['SELECT'],
    service_role: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  },
  lesson_progress: {
    anon: [],
    authenticated: ['SELECT'],
    service_role: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  },
  practice_activity_days: {
    anon: [],
    authenticated: ['SELECT'],
    service_role: ['INSERT', 'SELECT'],
  },
}

const TABLE_PRIVILEGES = [
  'DELETE',
  'INSERT',
  'REFERENCES',
  'SELECT',
  'TRIGGER',
  'TRUNCATE',
  'UPDATE',
]

async function assertGrantHardening(label) {
  const tables = Object.keys(HARDENED_TABLE_PRIVILEGES)
  const roles = ['anon', 'authenticated', 'service_role']
  const effective = await client.query(
    `select target.table_name, target.role_name, target.privilege,
       has_table_privilege(
         target.role_name,
         format('%I.%I', 'public', target.table_name),
         target.privilege
       ) as granted
     from unnest($1::text[]) as tables(table_name)
     cross join unnest($2::text[]) as roles(role_name)
     cross join unnest($3::text[]) as privileges(privilege)
     cross join lateral (
       select tables.table_name, roles.role_name, privileges.privilege
     ) as target
     order by target.table_name, target.role_name, target.privilege`,
    [tables, roles, TABLE_PRIVILEGES],
  )
  for (const table of tables) {
    for (const role of roles) {
      const actual = effective.rows
        .filter((row) => row.table_name === table && row.role_name === role && row.granted)
        .map((row) => row.privilege)
      assert(
        JSON.stringify(actual) === JSON.stringify(HARDENED_TABLE_PRIVILEGES[table][role]),
        `${label}: ${table} ${role} privileges changed: ${JSON.stringify(actual)}`,
      )
    }
  }

  const rls = await client.query(
    `select c.relname as table_name, c.relrowsecurity, pg_get_userbyid(c.relowner) as owner
     from pg_class as c
     join pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any($1::text[])
     order by c.relname`,
    [tables],
  )
  assert(
    rls.rowCount === tables.length && rls.rows.every((row) => row.relrowsecurity === true),
    `${label}: hardened table RLS changed`,
  )
  assert(
    rls.rows.every((row) => typeof row.owner === 'string' && row.owner.length > 0),
    `${label}: hardened table ownership is missing`,
  )

  const obsoleteFunctions = await client.query(`
    select proname
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'is_valid_v2_score_payload_for_attempt',
        'is_valid_v3_score_payload_for_attempt',
        'is_valid_v3_score_1_payload_for_attempt',
        'is_valid_v3_score_2_payload_for_attempt',
        'enforce_note_feedback_target'
      ]::text[])
  `)
  assert(obsoleteFunctions.rowCount === 0, `${label}: obsolete functions remain callable`)

  const currentFunctions = await client.query(`
    select procedure.proname, procedure.prosecdef, procedure.provolatile,
      procedure.proconfig, pg_get_userbyid(procedure.proowner) as owner,
      current_user as migration_user,
      pg_get_function_identity_arguments(procedure.oid) as arguments
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'is_valid_current_score_payload_for_attempt',
        'raise_lesson_progress_from_attempt',
        'enforce_lesson_progress_integrity'
      ]::text[])
    order by procedure.proname
  `)
  assert(
    currentFunctions.rowCount === 3,
    `${label}: current progression function inventory changed`,
  )
  const validator = currentFunctions.rows.find(
    (row) => row.proname === 'is_valid_current_score_payload_for_attempt',
  )
  const raiser = currentFunctions.rows.find(
    (row) => row.proname === 'raise_lesson_progress_from_attempt',
  )
  const integrity = currentFunctions.rows.find(
    (row) => row.proname === 'enforce_lesson_progress_integrity',
  )
  assert(
    validator?.arguments === 'payload jsonb, attempt_mode text, attempt_score integer' &&
      validator.prosecdef === false &&
      validator.provolatile === 'i' &&
      validator.proconfig?.length === 1 &&
      validator.proconfig[0] === 'search_path=""',
    `${label}: current validator signature or attributes changed`,
  )
  assert(
    raiser?.arguments === '' &&
      raiser.prosecdef === true &&
      raiser.proconfig?.length === 1 &&
      raiser.proconfig[0] === 'search_path=""',
    `${label}: progression trigger function security changed`,
  )
  assert(
    integrity?.arguments === '' &&
      integrity.prosecdef === true &&
      integrity.proconfig?.length === 1 &&
      integrity.proconfig[0] === 'search_path=""' &&
      currentFunctions.rows.every(
        (row) =>
          row.owner === validator.owner &&
          row.owner === row.migration_user &&
          !['anon', 'authenticated', 'service_role'].includes(row.owner),
      ),
    `${label}: progression integrity function security or ownership changed`,
  )

  const triggers = await client.query(`
    select trigger.tgname, relation.relname as table_name,
      procedure.proname as function_name,
      (trigger.tgtype & 2) = 2 as before,
      (trigger.tgtype & 4) = 4 as on_insert,
      (trigger.tgtype & 16) = 16 as on_update
    from pg_trigger as trigger
    join pg_class as relation on relation.oid = trigger.tgrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    join pg_proc as procedure on procedure.oid = trigger.tgfoid
    where namespace.nspname = 'public' and not trigger.tgisinternal
    order by trigger.tgname
  `)
  assert(
    JSON.stringify(triggers.rows) ===
      JSON.stringify([
        {
          tgname: 'attempts_enforce_status_transition',
          table_name: 'attempts',
          function_name: 'enforce_attempt_status_transition',
          before: true,
          on_insert: false,
          on_update: true,
        },
        {
          tgname: 'attempts_lock_owner_mutation',
          table_name: 'attempts',
          function_name: 'lock_attempt_owner_mutation',
          before: true,
          on_insert: true,
          on_update: true,
        },
        {
          tgname: 'attempts_raise_lesson_progress',
          table_name: 'attempts',
          function_name: 'raise_lesson_progress_from_attempt',
          before: false,
          on_insert: true,
          on_update: true,
        },
        {
          tgname: 'lesson_progress_enforce_integrity',
          table_name: 'lesson_progress',
          function_name: 'enforce_lesson_progress_integrity',
          before: true,
          on_insert: true,
          on_update: true,
        },
        {
          tgname: 'practice_chapters_enforce_identity',
          table_name: 'practice_chapters',
          function_name: 'enforce_practice_chapter_identity',
          before: true,
          on_insert: false,
          on_update: true,
        },
        {
          tgname: 'practice_lessons_enforce_identity',
          table_name: 'practice_lessons',
          function_name: 'enforce_practice_lesson_identity',
          before: true,
          on_insert: false,
          on_update: true,
        },
        {
          tgname: 'practice_paths_enforce_identity',
          table_name: 'practice_paths',
          function_name: 'enforce_practice_path_identity',
          before: true,
          on_insert: false,
          on_update: true,
        },
      ]),
    `${label}: final trigger inventory changed`,
  )

  const browserFunctions = new Set([
    'replace_profile_path_preferences',
    'is_valid_iana_timezone',
    'can_write_owned_recording',
    'assert_my_data_deletion_safe',
    'reset_my_progress',
  ])
  const functionNames = [
    'handle_new_user',
    'replace_profile_path_preferences',
    'raise_lesson_progress_from_attempt',
    'is_valid_current_score_payload_for_attempt',
    'enforce_lesson_progress_integrity',
    'enforce_practice_path_identity',
    'enforce_practice_chapter_identity',
    'enforce_practice_lesson_identity',
    'is_valid_iana_timezone',
    'is_valid_current_activity_attempt',
    'lock_attempt_owner_mutation',
    'can_write_owned_recording',
    'rebuild_owned_lesson_progress',
    'record_practice_activity_for_attempt',
    'delete_owned_attempt_and_rebuild',
    'assert_my_data_deletion_safe',
    'reset_my_progress',
  ]
  const functionAccess = await client.query(
    `select p.proname as function_name, target.role_name,
       has_function_privilege(target.role_name, p.oid, 'EXECUTE') as can_execute
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace
     cross join unnest($1::text[]) as target(role_name)
     where n.nspname = 'public' and p.proname = any($2::text[])
     order by p.proname, target.role_name`,
    [roles, functionNames],
  )
  for (const functionName of functionNames) {
    for (const role of roles) {
      const actual = functionAccess.rows.find(
        (row) => row.function_name === functionName && row.role_name === role,
      )?.can_execute
      const expected =
        role === 'service_role' || (role === 'authenticated' && browserFunctions.has(functionName))
      assert(actual === expected, `${label}: ${functionName} ${role} EXECUTE changed`)
    }
  }

  await client.query('set role anon')
  try {
    const curriculum = await client.query(`select
      (select count(*)::integer from public.practice_paths) as paths,
      (select count(*)::integer from public.practice_chapters) as chapters,
      (select count(*)::integer from public.practice_lessons) as lessons`)
    assert(
      curriculum.rows[0]?.paths === 4 &&
        curriculum.rows[0]?.chapters === 12 &&
        curriculum.rows[0]?.lessons === 120,
      `${label}: anonymous curriculum read failed`,
    )
    await expectPgError(
      () =>
        client.query("update public.practice_paths set title = title where slug = 'interviews'"),
      '42501',
      `${label}: anonymous curriculum update`,
    )
  } finally {
    await resetRole()
  }

  await setAuthenticatedUser(USERS.owner)
  try {
    await expectPgError(
      () =>
        client.query("update public.practice_paths set title = title where slug = 'interviews'"),
      '42501',
      `${label}: authenticated curriculum update`,
    )
  } finally {
    await resetRole()
  }

  await seedAuthUser(USERS.hardeningSignup, 'Hardening Signup')
  const signupRows = await client.query(
    `select
       (select count(*)::integer from public.profiles where id = $1) as profiles,
       (select count(*)::integer from public.profile_path_preferences where user_id = $1) as preferences`,
    [USERS.hardeningSignup],
  )
  assert(
    signupRows.rows[0]?.profiles === 1 && signupRows.rows[0]?.preferences === 1,
    `${label}: hardened signup trigger failed`,
  )

  const progress = await client.query(
    'select user_id, lesson_id from public.lesson_progress order by updated_at limit 1',
  )
  assert(progress.rowCount === 1, `${label}: progress service-write fixture is missing`)
  await client.query('set role service_role')
  try {
    const curriculumUpdate = await client.query(
      "update public.practice_paths set title = title where slug = 'interviews' returning id",
    )
    assert(curriculumUpdate.rowCount === 1, `${label}: service curriculum update failed`)
    const preferenceUpdate = await client.query(
      `update public.profile_path_preferences set updated_at = updated_at
       where user_id = $1 returning user_id`,
      [USERS.hardeningSignup],
    )
    assert(preferenceUpdate.rowCount === 1, `${label}: service preference update failed`)
    const progressUpdate = await client.query(
      `update public.lesson_progress set best_score = best_score
       where user_id = $1 and lesson_id = $2 returning user_id`,
      [progress.rows[0].user_id, progress.rows[0].lesson_id],
    )
    assert(progressUpdate.rowCount === 1, `${label}: service progress update failed`)
    const activityInsert = await client.query(
      `insert into public.practice_activity_days (user_id, local_date, timezone)
       values ($1, '2031-01-01', 'UTC') returning user_id`,
      [USERS.hardeningSignup],
    )
    assert(activityInsert.rowCount === 1, `${label}: service activity insert failed`)
  } finally {
    await resetRole()
  }
  await client.query('delete from auth.users where id = $1', [USERS.hardeningSignup])
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
  const retiredValidator = await client.query(
    `select to_regprocedure('public.enforce_note_feedback_target()')::text as function_name,
       exists (
         select 1 from pg_trigger
         where tgrelid = 'public.note_feedback'::regclass
           and tgname = 'note_feedback_enforce_target'
           and not tgisinternal
       ) as has_trigger`,
  )
  if (
    retiredValidator.rows[0]?.function_name === null &&
    retiredValidator.rows[0]?.has_trigger === false
  ) {
    const archivePrivileges = await client.query(`
      select grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'note_feedback'
        and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      order by grantee, privilege_type
    `)
    assert(
      JSON.stringify(archivePrivileges.rows) ===
        JSON.stringify([
          { grantee: 'authenticated', privilege_type: 'SELECT' },
          { grantee: 'service_role', privilege_type: 'SELECT' },
        ]),
      `${label}: retired note feedback must be a read-only archive`,
    )
    const effectiveArchivePrivileges = await client.query(
      `select role_name, privilege,
         has_table_privilege(role_name, 'public.note_feedback', privilege) as granted
       from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name)
       cross join unnest($1::text[]) as privileges(privilege)
       order by role_name, privilege`,
      [TABLE_PRIVILEGES],
    )
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const actual = effectiveArchivePrivileges.rows
        .filter((row) => row.role_name === role && row.granted)
        .map((row) => row.privilege)
      const expected = role === 'anon' ? [] : ['SELECT']
      assert(
        JSON.stringify(actual) === JSON.stringify(expected),
        `${label}: ${role} inherited unexpected note-feedback privileges`,
      )
    }
    const archive = await client.query(`
      select c.relrowsecurity,
        array_agg(policy.cmd order by policy.cmd) filter (where policy.cmd is not null) as commands
      from pg_class as c
      left join pg_policies as policy
        on policy.schemaname = 'public' and policy.tablename = c.relname
      where c.oid = 'public.note_feedback'::regclass
      group by c.relrowsecurity
    `)
    assert(
      archive.rows[0]?.relrowsecurity === true &&
        JSON.stringify(archive.rows[0]?.commands) === '["SELECT"]',
      `${label}: retired note feedback lost RLS or its owner-read policy`,
    )
    await setAuthenticatedUser(USERS.owner)
    try {
      const visible = await client.query('select user_id from public.note_feedback')
      assert(
        visible.rows.every((row) => row.user_id === USERS.owner),
        `${label}: retired note feedback owner read leaked`,
      )
      await expectPgError(
        () =>
          client.query(
            `insert into public.note_feedback (user_id, attempt_id, note_type)
             values ($1, gen_random_uuid(), 'retired')`,
            [USERS.owner],
          ),
        '42501',
        `${label}: authenticated retired note insert`,
      )
    } finally {
      await resetRole()
    }
    await client.query('set role service_role')
    try {
      await expectPgError(
        () =>
          client.query(
            `insert into public.note_feedback (user_id, attempt_id, note_type)
             values ($1, gen_random_uuid(), 'retired')`,
            [USERS.owner],
          ),
        '42501',
        `${label}: service-role retired note insert`,
      )
    } finally {
      await resetRole()
    }
    return
  }

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

const V3_SCORE_1_MODE_WEIGHTS = {
  practice: {
    what_you_said: {
      answered_prompt: 10,
      specificity: 9,
      structure: 9,
      conciseness: 8,
      word_choice: 7,
      grammar: 7,
    },
    how_you_sounded: {
      pace: 12,
      time_to_first_word: 5,
      paused_time: 10,
      articulation: 13,
      energy: 10,
    },
  },
  interview: {
    what_you_said: {
      answered_prompt: 12,
      specificity: 11,
      structure: 10,
      conciseness: 6,
      word_choice: 6,
      grammar: 5,
    },
    how_you_sounded: {
      pace: 10,
      time_to_first_word: 6,
      paused_time: 9,
      articulation: 15,
      energy: 10,
    },
  },
  presentation: {
    what_you_said: {
      answered_prompt: 9,
      specificity: 9,
      structure: 12,
      conciseness: 7,
      word_choice: 7,
      grammar: 6,
    },
    how_you_sounded: {
      pace: 12,
      time_to_first_word: 3,
      paused_time: 9,
      articulation: 11,
      energy: 15,
    },
  },
  conversation: {
    what_you_said: {
      answered_prompt: 9,
      specificity: 8,
      structure: 7,
      conciseness: 10,
      word_choice: 8,
      grammar: 8,
    },
    how_you_sounded: {
      pace: 11,
      time_to_first_word: 4,
      paused_time: 10,
      articulation: 15,
      energy: 10,
    },
  },
}

const V3_MODE_WEIGHTS = {
  practice: {
    what_you_said: V3_SCORE_1_MODE_WEIGHTS.practice.what_you_said,
    how_you_sounded: { pace: 12, paused_time: 15, articulation: 13, energy: 10 },
  },
  interview: {
    what_you_said: V3_SCORE_1_MODE_WEIGHTS.interview.what_you_said,
    how_you_sounded: { pace: 10, paused_time: 15, articulation: 15, energy: 10 },
  },
  presentation: {
    what_you_said: V3_SCORE_1_MODE_WEIGHTS.presentation.what_you_said,
    how_you_sounded: { pace: 12, paused_time: 12, articulation: 11, energy: 15 },
  },
  conversation: {
    what_you_said: V3_SCORE_1_MODE_WEIGHTS.conversation.what_you_said,
    how_you_sounded: { pace: 11, paused_time: 14, articulation: 15, energy: 10 },
  },
}

function structuredV3ScorePayloadFor(mode, score, weightsByMode, version) {
  const weights = weightsByMode[mode]
  assert(weights, `unsupported v3 score mode: ${mode}`)
  const maximums = { ...weights.what_you_said, ...weights.how_you_sounded }
  const allocated = allocateScore(maximums, score)
  const allMetrics = Object.fromEntries(
    Object.entries(maximums).map(([metric, maximum]) => {
      const earned = allocated[metric]
      return [
        metric,
        {
          metric,
          status: 'scored',
          component: earned / maximum,
          earned_points: earned,
          max_points: maximum,
          explanation: `You have measured ${metric} evidence.`,
          measurements: {},
          evidence: [],
          details: [],
          warnings: [],
        },
      ]
    }),
  )
  const transcriptEvidence = {
    source: 'transcript',
    start: 0,
    end: 2,
    coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
    quote: '😀',
    detail: 'A valid UTF-16 transcript span.',
  }
  allMetrics.structure.measurements = {
    count: 1,
    checked: true,
    label: 'structured',
    optional: null,
  }
  allMetrics.structure.evidence = [transcriptEvidence]
  allMetrics.structure.details = [
    {
      kind: 'structure',
      source: 'ai',
      quote: '😀',
      observation: 'The response follows a visible sequence.',
      suggestion: null,
      evidence: [transcriptEvidence],
    },
  ]
  const buildSection = (sectionName, sectionWeights) => {
    const metrics = Object.fromEntries(
      Object.keys(sectionWeights).map((metric) => [metric, allMetrics[metric]]),
    )
    return {
      section: sectionName,
      status: 'scored',
      earned_points: Object.values(metrics).reduce(
        (total, metric) => total + metric.earned_points,
        0,
      ),
      max_points: 50,
      metrics,
    }
  }
  const ordered = Object.values(allMetrics)
  const strongest = ordered.reduce((selected, candidate) =>
    candidate.component > selected.component ? candidate : selected,
  )
  const weakest = [...ordered]
    .reverse()
    .reduce((selected, candidate) =>
      candidate.component < selected.component ? candidate : selected,
    )
  return {
    version,
    rubric_version: 'v3',
    mode,
    total_earned_points: score,
    total_max_points: 100,
    sections: {
      what_you_said: buildSection('what_you_said', weights.what_you_said),
      how_you_sounded: buildSection('how_you_sounded', weights.how_you_sounded),
    },
    recommendation: {
      strongest_metric: strongest.metric,
      weakest_metric: weakest.metric,
      text:
        strongest.metric === weakest.metric
          ? strongest.explanation
          : `${strongest.explanation} ${weakest.explanation}`,
    },
    warnings: [],
  }
}

function structuredV3ScorePayload(mode, score) {
  return structuredV3ScorePayloadFor(mode, score, V3_MODE_WEIGHTS, 'v3.score.2')
}

function structuredLegacyV3ScorePayload(mode, score) {
  return structuredV3ScorePayloadFor(mode, score, V3_SCORE_1_MODE_WEIGHTS, 'v3.score.1')
}

function neutralV3ScorePayload(mode, score, metric = 'grammar') {
  const payload = cloneJson(structuredV3ScorePayload(mode, score))
  const section = Object.values(payload.sections).find(
    (candidate) => candidate.metrics[metric] !== undefined,
  )
  assert(section, `neutral metric ${metric} is missing`)
  section.metrics[metric] = {
    ...section.metrics[metric],
    status: 'not_checked',
    component: null,
    earned_points: null,
    explanation: null,
    measurements: null,
    evidence: [],
    details: [],
    warnings: ['Provider result was unavailable.'],
  }
  section.status = 'not_checked'
  section.earned_points = null
  payload.total_earned_points = null
  payload.recommendation = null
  payload.warnings = ['Provider result was unavailable.']
  return payload
}

function malformedV3Payloads(mode, score) {
  const wrongWeight = cloneJson(structuredV3ScorePayload(mode, score))
  wrongWeight.sections.how_you_sounded.metrics.energy.max_points += 1

  const hiddenMetric = cloneJson(structuredV3ScorePayload(mode, score))
  hiddenMetric.sections.what_you_said.metrics.hidden = {
    ...hiddenMetric.sections.what_you_said.metrics.grammar,
    metric: 'hidden',
    max_points: 0,
    earned_points: 0,
    component: 0,
  }

  const missingMetricField = cloneJson(structuredV3ScorePayload(mode, score))
  delete missingMetricField.sections.what_you_said.metrics.structure.component

  const incoherentSection = cloneJson(structuredV3ScorePayload(mode, score))
  incoherentSection.sections.how_you_sounded.earned_points -= 1

  const incoherentStatus = cloneJson(structuredV3ScorePayload(mode, score))
  incoherentStatus.sections.how_you_sounded.status = 'unavailable'

  const extraTopLevelField = cloneJson(structuredV3ScorePayload(mode, score))
  extraTopLevelField.hidden_score = 100

  const malformedEvidence = cloneJson(structuredV3ScorePayload(mode, score))
  malformedEvidence.sections.what_you_said.metrics.structure.evidence = [{}]

  const malformedDetail = cloneJson(structuredV3ScorePayload(mode, score))
  malformedDetail.sections.what_you_said.metrics.structure.details = [{}]

  const nestedMeasurement = cloneJson(structuredV3ScorePayload(mode, score))
  nestedMeasurement.sections.how_you_sounded.metrics.energy.measurements = { nested: [] }

  const arbitraryRecommendation = cloneJson(structuredV3ScorePayload(mode, score))
  arbitraryRecommendation.recommendation.text = 'This is not deterministic coaching copy.'

  const wrongRecommendationMetric = cloneJson(structuredV3ScorePayload(mode, score))
  wrongRecommendationMetric.recommendation.strongest_metric =
    wrongRecommendationMetric.recommendation.weakest_metric

  const overlongExplanation = cloneJson(structuredV3ScorePayload(mode, score))
  overlongExplanation.sections.what_you_said.metrics.structure.explanation = 'x'.repeat(1001)

  const invalidCoordinate = cloneJson(structuredV3ScorePayload(mode, score))
  invalidCoordinate.sections.what_you_said.metrics.structure.evidence = [
    {
      source: 'transcript',
      start: 0,
      end: 2,
      coordinate: { space: 'transcript', unit: 'utf16_code_unit' },
      quote: 'x',
      detail: 'The quote length does not match the coordinate.',
    },
  ]

  const emptyCoordinate = cloneJson(structuredV3ScorePayload(mode, score))
  emptyCoordinate.sections.what_you_said.metrics.structure.evidence[0].coordinate = {}

  const overlongUnicodeWarning = cloneJson(structuredV3ScorePayload(mode, score))
  overlongUnicodeWarning.sections.what_you_said.metrics.structure.warnings = ['😀'.repeat(501)]

  const unmatchedDetailQuote = cloneJson(structuredV3ScorePayload(mode, score))
  unmatchedDetailQuote.sections.what_you_said.metrics.structure.details = [
    {
      kind: 'structure',
      source: 'ai',
      quote: 'missing',
      observation: 'This quote has no matching evidence.',
      suggestion: null,
      evidence: [],
    },
  ]

  return [
    wrongWeight,
    hiddenMetric,
    missingMetricField,
    incoherentSection,
    incoherentStatus,
    extraTopLevelField,
    malformedEvidence,
    malformedDetail,
    nestedMeasurement,
    arbitraryRecommendation,
    wrongRecommendationMetric,
    overlongExplanation,
    invalidCoordinate,
    emptyCoordinate,
    overlongUnicodeWarning,
    unmatchedDetailQuote,
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
    select lesson.id, lesson.prompt_id, path.mode, chapter.level as difficulty
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
       'v3', 'done', '2026-08-28T10:00:00Z', null, $5::jsonb)
     returning id`,
    [
      USERS.owner,
      target.prompt_id,
      target.id,
      target.mode,
      JSON.stringify(neutralV3ScorePayload(target.mode, 80)),
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
         'v3', 'done', $5::timestamptz, $6, $7::jsonb)
       returning id`,
      [
        USERS.owner,
        target.prompt_id,
        target.id,
        target.mode,
        finishedAt,
        score,
        JSON.stringify(structuredV3ScorePayload(target.mode, score)),
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
       'v3', 'done', '2026-08-28T10:04:00Z', 80, $5::jsonb)
     returning id`,
    [
      USERS.owner,
      target.prompt_id,
      target.id,
      target.mode,
      JSON.stringify(structuredV3ScorePayload(target.mode, 80)),
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

  for (const [index, payload] of malformedV3Payloads(target.mode, 90).entries()) {
    const malformedAttempt = await client.query(
      `insert into public.attempts (
         user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
         prompt_difficulty, rubric_version, status, finished_at, score, section_scores
       ) values ($1, $2, $3, 'Malformed structured snapshot', $4, 'library', 'beginner',
         'v3', 'done', $5::timestamptz, 90, $6::jsonb)
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
       'beginner', 'v3', 'done', '2026-08-28T10:20:00Z', null, $5::jsonb)
     returning id`,
    [
      USERS.other,
      target.prompt_id,
      target.id,
      target.mode,
      JSON.stringify(structuredV3ScorePayload(target.mode, 90)),
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

async function assertV3Progression(label) {
  for (const mode of Object.keys(V3_MODE_WEIGHTS)) {
    const payload = structuredV3ScorePayload(mode, 83)
    const valid = await client.query(
      `select public.is_valid_current_score_payload_for_attempt(
         $1::jsonb, $2, 83
       ) as valid`,
      [JSON.stringify(payload), mode],
    )
    assert(valid.rows[0]?.valid === true, `${label}: ${mode} v3 weights were rejected`)
    const legacy = await client.query(
      `select public.is_valid_current_score_payload_for_attempt(
         $1::jsonb, $2, 83
       ) as valid`,
      [JSON.stringify(structuredLegacyV3ScorePayload(mode, 83)), mode],
    )
    assert(legacy.rows[0]?.valid === false, `${label}: ${mode} v3.score.1 did not fail closed`)

    const future = cloneJson(payload)
    future.version = 'v3.score.99'
    const futureResult = await client.query(
      `select public.is_valid_current_score_payload_for_attempt(
         $1::jsonb, $2, 83
       ) as valid`,
      [JSON.stringify(future), mode],
    )
    assert(futureResult.rows[0]?.valid === false, `${label}: ${mode} future v3 did not fail closed`)
  }

  const practice83 = JSON.stringify(structuredV3ScorePayload('practice', 83))
  const scalarMismatch = await client.query(
    `select public.is_valid_current_score_payload_for_attempt(
       $1::jsonb, 'practice', 82
     ) as valid`,
    [practice83],
  )
  assert(scalarMismatch.rows[0]?.valid === false, `${label}: scalar score mismatch passed`)
  const nonFiniteMeasurement = await client.query(
    `select public.is_valid_current_score_payload_for_attempt(
       jsonb_set(
         $1::jsonb,
         '{sections,how_you_sounded,metrics,energy,measurements,overflow}',
         '1e10000'::jsonb,
         true
       ),
       'practice',
       83
     ) as valid`,
    [practice83],
  )
  assert(
    nonFiniteMeasurement.rows[0]?.valid === false,
    `${label}: a measurement outside the JavaScript finite range passed`,
  )

  const lessons = await client.query(`
    select lesson.id, lesson.prompt_id, path.mode, chapter.level as difficulty
    from public.practice_lessons as lesson
    join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
    join public.practice_paths as path on path.id = chapter.path_id
    where path.slug = 'general-speaking'
    order by chapter.position, lesson.position
    limit 3
  `)
  const target = lessons.rows[0]
  const malformedTarget = lessons.rows[1]
  const lockedTarget = lessons.rows[2]
  assert(
    target && malformedTarget && lockedTarget,
    `${label}: v3 progress test lessons are missing`,
  )

  const insertAttempt = async ({ userId, lesson, rubricVersion, score, payload, finishedAt }) =>
    client.query(
      `insert into public.attempts (
         user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
         prompt_difficulty, rubric_version, status, finished_at, score, section_scores
       ) values ($1, $2, $3, 'Versioned progression snapshot', $4, 'library', $5,
         $6, 'done', $7::timestamptz, $8, $9::jsonb)
       returning id`,
      [
        userId,
        lesson.prompt_id,
        lesson.id,
        lesson.mode,
        lesson.difficulty,
        rubricVersion,
        finishedAt,
        score,
        JSON.stringify(payload),
      ],
    )

  const obsoleteAttempt = await insertAttempt({
    userId: USERS.owner,
    lesson: target,
    rubricVersion: 'v2',
    score: 72,
    payload: structuredScorePayload(target.mode, 72),
    finishedAt: '2026-09-03T10:00:00Z',
  })
  const progressAfterObsolete = await client.query(
    `select count(*)::integer as count from public.lesson_progress
     where best_attempt_id = $1`,
    [obsoleteAttempt.rows[0].id],
  )
  assert(progressAfterObsolete.rows[0]?.count === 0, `${label}: a v2 result raised progress`)
  const v3Attempt = await insertAttempt({
    userId: USERS.owner,
    lesson: target,
    rubricVersion: 'v3',
    score: 92,
    payload: structuredV3ScorePayload(target.mode, 92),
    finishedAt: '2026-09-03T10:01:00Z',
  })
  const progressAfter92 = await client.query(
    `select best_score, best_attempt_id from public.lesson_progress
     where user_id = $1 and lesson_id = $2`,
    [USERS.owner, target.id],
  )
  assert(
    progressAfter92.rows[0]?.best_score === 92 &&
      progressAfter92.rows[0]?.best_attempt_id === v3Attempt.rows[0]?.id,
    `${label}: a complete 92-point v3 attempt did not become the durable best`,
  )

  await insertAttempt({
    userId: USERS.owner,
    lesson: target,
    rubricVersion: 'v3',
    score: 70,
    payload: structuredV3ScorePayload(target.mode, 70),
    finishedAt: '2026-09-03T10:02:00Z',
  })
  const progressAfterLowerRetry = await client.query(
    `select best_score, best_attempt_id from public.lesson_progress
     where user_id = $1 and lesson_id = $2`,
    [USERS.owner, target.id],
  )
  assert(
    progressAfterLowerRetry.rows[0]?.best_score === 92 &&
      progressAfterLowerRetry.rows[0]?.best_attempt_id === v3Attempt.rows[0]?.id,
    `${label}: a lower v3 retry reduced the durable best`,
  )

  const higherRetry = await insertAttempt({
    userId: USERS.owner,
    lesson: target,
    rubricVersion: 'v3',
    score: 95,
    payload: structuredV3ScorePayload(target.mode, 95),
    finishedAt: '2026-09-03T10:03:00Z',
  })
  const progressAfterHigherRetry = await client.query(
    `select best_score, best_attempt_id from public.lesson_progress
     where user_id = $1 and lesson_id = $2`,
    [USERS.owner, target.id],
  )
  assert(
    progressAfterHigherRetry.rows[0]?.best_score === 95 &&
      progressAfterHigherRetry.rows[0]?.best_attempt_id === higherRetry.rows[0]?.id,
    `${label}: a higher v3 retry did not replace the durable best`,
  )

  const nextLessonAttempt = await insertAttempt({
    userId: USERS.owner,
    lesson: malformedTarget,
    rubricVersion: 'v3',
    score: 69,
    payload: structuredV3ScorePayload(malformedTarget.mode, 69),
    finishedAt: '2026-09-03T10:04:00Z',
  })
  const nextProgress = await client.query(
    `select best_score, best_attempt_id from public.lesson_progress
     where user_id = $1 and lesson_id = $2`,
    [USERS.owner, malformedTarget.id],
  )
  assert(
    nextProgress.rows[0]?.best_score === 69 &&
      nextProgress.rows[0]?.best_attempt_id === nextLessonAttempt.rows[0]?.id,
    `${label}: a reachable below-threshold result was not retained`,
  )
  const blockedAfter69 = await insertAttempt({
    userId: USERS.owner,
    lesson: lockedTarget,
    rubricVersion: 'v3',
    score: 95,
    payload: structuredV3ScorePayload(lockedTarget.mode, 95),
    finishedAt: '2026-09-03T10:04:30Z',
  })
  const blockedAfter69Progress = await client.query(
    'select count(*)::integer as count from public.lesson_progress where best_attempt_id = $1',
    [blockedAfter69.rows[0].id],
  )
  assert(
    blockedAfter69Progress.rows[0]?.count === 0,
    `${label}: a 69-point lesson unlocked its successor`,
  )

  const unreachableAttempt = await insertAttempt({
    userId: USERS.other,
    lesson: malformedTarget,
    rubricVersion: 'v3',
    score: 90,
    payload: structuredV3ScorePayload(malformedTarget.mode, 90),
    finishedAt: '2026-09-03T10:05:00Z',
  })
  const unreachableProgress = await client.query(
    `select count(*)::integer as count from public.lesson_progress
     where best_attempt_id = $1`,
    [unreachableAttempt.rows[0].id],
  )
  assert(unreachableProgress.rows[0]?.count === 0, `${label}: an unreachable lesson progressed`)

  const neutralAttempt = await insertAttempt({
    userId: USERS.other,
    lesson: target,
    rubricVersion: 'v3',
    score: null,
    payload: neutralV3ScorePayload(target.mode, 80),
    finishedAt: '2026-09-03T10:06:00Z',
  })
  const neutralProgress = await client.query(
    `select count(*)::integer as count from public.lesson_progress
     where best_attempt_id = $1`,
    [neutralAttempt.rows[0].id],
  )
  assert(neutralProgress.rows[0]?.count === 0, `${label}: a neutral result raised progress`)

  const tieAttemptIds = [
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002',
  ]
  for (const attemptId of tieAttemptIds) {
    await client.query(
      `insert into public.attempts (
         id, user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
         prompt_difficulty, rubric_version, status, finished_at, score, section_scores
       ) values ($1, $2, $3, $4, 'Deterministic tie snapshot', $5, 'library', $6,
         'v3', 'done', '2026-09-03T10:07:00Z', 80, $7::jsonb)`,
      [
        attemptId,
        USERS.other,
        target.prompt_id,
        target.id,
        target.mode,
        target.difficulty,
        JSON.stringify(structuredV3ScorePayload(target.mode, 80)),
      ],
    )
  }
  const deterministicTie = await client.query(
    `select best_score, best_attempt_id from public.lesson_progress
     where user_id = $1 and lesson_id = $2`,
    [USERS.other, target.id],
  )
  assert(
    deterministicTie.rows[0]?.best_score === 80 &&
      deterministicTie.rows[0]?.best_attempt_id === tieAttemptIds[1],
    `${label}: equal score and completion time did not prefer the greater UUID`,
  )

  const topologyAttempts = []
  for (const fixture of [
    {
      promptId: malformedTarget.prompt_id,
      mode: target.mode,
      source: 'library',
      difficulty: target.difficulty,
    },
    {
      promptId: target.prompt_id,
      mode: target.mode,
      source: 'custom',
      difficulty: target.difficulty,
    },
    {
      promptId: target.prompt_id,
      mode: target.mode,
      source: 'library',
      difficulty: 'advanced',
    },
    {
      promptId: target.prompt_id,
      mode: 'interview',
      source: 'library',
      difficulty: target.difficulty,
    },
  ]) {
    const topologyAttempt = await client.query(
      `insert into public.attempts (
         user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
         prompt_difficulty, rubric_version, status, finished_at, score, section_scores
       ) values ($1, $2, $3, 'Invalid topology snapshot', $4, $5, $6,
         'v3', 'done', '2026-09-03T10:08:00Z', 90, $7::jsonb)
       returning id`,
      [
        USERS.other,
        fixture.promptId,
        target.id,
        fixture.mode,
        fixture.source,
        fixture.difficulty,
        JSON.stringify(structuredV3ScorePayload(fixture.mode, 90)),
      ],
    )
    topologyAttempts.push(topologyAttempt.rows[0].id)
  }
  const topologyProgress = await client.query(
    `select count(*)::integer as count from public.lesson_progress
     where best_attempt_id = any($1::uuid[])`,
    [topologyAttempts],
  )
  assert(topologyProgress.rows[0]?.count === 0, `${label}: invalid attempt topology progressed`)

  const rejectedAttemptIds = []
  const futurePayload = cloneJson(structuredV3ScorePayload(malformedTarget.mode, 90))
  futurePayload.version = 'v3.score.99'
  const mixedPayloads = [
    ['v2', structuredScorePayload(malformedTarget.mode, 90)],
    ['v3', structuredLegacyV3ScorePayload(malformedTarget.mode, 90)],
    [null, legacyActivityPayload(90)],
    ['v3', futurePayload],
    ['v2', structuredV3ScorePayload(malformedTarget.mode, 90)],
  ]
  for (const [index, [rubricVersion, payload]] of mixedPayloads.entries()) {
    const attempt = await insertAttempt({
      userId: USERS.other,
      lesson: malformedTarget,
      rubricVersion,
      score: 90,
      payload,
      finishedAt: `2026-09-03T10:${String(index + 3).padStart(2, '0')}:00Z`,
    })
    rejectedAttemptIds.push(attempt.rows[0].id)
  }
  for (const [index, payload] of malformedV3Payloads(malformedTarget.mode, 90).entries()) {
    const validation = await client.query(
      `select public.is_valid_current_score_payload_for_attempt(
         $1::jsonb, $2, 90
       ) as valid`,
      [JSON.stringify(payload), malformedTarget.mode],
    )
    assert(
      validation.rows[0]?.valid === false,
      `${label}: malformed v3 payload ${index + 1} passed`,
    )
    const attempt = await insertAttempt({
      userId: USERS.other,
      lesson: malformedTarget,
      rubricVersion: 'v3',
      score: 90,
      payload,
      finishedAt: `2026-09-03T11:${String(index).padStart(2, '0')}:00Z`,
    })
    rejectedAttemptIds.push(attempt.rows[0].id)
  }
  const rejectedProgress = await client.query(
    `select count(*)::integer as count from public.lesson_progress
     where best_attempt_id = any($1::uuid[])`,
    [rejectedAttemptIds],
  )
  assert(rejectedProgress.rows[0]?.count === 0, `${label}: mixed or malformed v3 raised progress`)

  await client.query('set role service_role')
  try {
    await expectPgError(
      () =>
        client.query(
          `update public.lesson_progress
           set best_score = 99, best_attempt_id = $1
           where user_id = $2 and lesson_id = $3`,
          [obsoleteAttempt.rows[0].id, USERS.owner, target.id],
        ),
      '23514',
      `${label}: obsolete forged durable best`,
    )
    await expectPgError(
      () =>
        client.query(
          `insert into public.lesson_progress (user_id, lesson_id, best_score, best_attempt_id)
           values ($1, $2, 90, $3)`,
          [USERS.other, malformedTarget.id, rejectedAttemptIds[0]],
        ),
      '23514',
      `${label}: malformed forged durable best`,
    )
    await expectPgError(
      () =>
        client.query(
          `insert into public.lesson_progress (user_id, lesson_id, best_score, best_attempt_id)
           values ($1, $2, 92, $3)`,
          [USERS.other, malformedTarget.id, v3Attempt.rows[0].id],
        ),
      '23514',
      `${label}: mismatched-user forged durable best`,
    )
  } finally {
    await resetRole()
  }

  await seedAuthUser(USERS.progression, `${label} progression`)
  const checkpointLessons = await client.query(`
    select lesson.id, lesson.prompt_id, path.mode, chapter.level as difficulty,
      chapter.position as chapter_position, lesson.position as lesson_position
    from public.practice_lessons as lesson
    join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
    join public.practice_paths as path on path.id = chapter.path_id
    where path.slug = 'general-speaking'
    order by chapter.position, lesson.position
    limit 11
  `)
  assert(checkpointLessons.rowCount === 11, `${label}: checkpoint fixtures are missing`)
  const chapterTwoFirst = checkpointLessons.rows[10]
  for (const [index, lesson] of checkpointLessons.rows.slice(0, 9).entries()) {
    await insertAttempt({
      userId: USERS.progression,
      lesson,
      rubricVersion: 'v3',
      score: 75,
      payload: structuredV3ScorePayload(lesson.mode, 75),
      finishedAt: `2026-09-04T10:${String(index).padStart(2, '0')}:00Z`,
    })
  }
  const checkpoint = checkpointLessons.rows[9]
  await insertAttempt({
    userId: USERS.progression,
    lesson: checkpoint,
    rubricVersion: 'v3',
    score: 69,
    payload: structuredV3ScorePayload(checkpoint.mode, 69),
    finishedAt: '2026-09-04T10:09:00Z',
  })
  const blockedAcrossCheckpoint = await insertAttempt({
    userId: USERS.progression,
    lesson: chapterTwoFirst,
    rubricVersion: 'v3',
    score: 95,
    payload: structuredV3ScorePayload(chapterTwoFirst.mode, 95),
    finishedAt: '2026-09-04T10:10:00Z',
  })
  let checkpointProgress = await client.query(
    'select count(*)::integer as count from public.lesson_progress where best_attempt_id = $1',
    [blockedAcrossCheckpoint.rows[0].id],
  )
  assert(
    checkpointProgress.rows[0]?.count === 0,
    `${label}: a 69-point checkpoint unlocked the next chapter`,
  )
  await insertAttempt({
    userId: USERS.progression,
    lesson: checkpoint,
    rubricVersion: 'v3',
    score: 85,
    payload: structuredV3ScorePayload(checkpoint.mode, 85),
    finishedAt: '2026-09-04T10:11:00Z',
  })
  const acceptedAcrossCheckpoint = await insertAttempt({
    userId: USERS.progression,
    lesson: chapterTwoFirst,
    rubricVersion: 'v3',
    score: 95,
    payload: structuredV3ScorePayload(chapterTwoFirst.mode, 95),
    finishedAt: '2026-09-04T10:12:00Z',
  })
  checkpointProgress = await client.query(
    `select best_score, best_attempt_id from public.lesson_progress
     where user_id = $1 and lesson_id = $2`,
    [USERS.progression, chapterTwoFirst.id],
  )
  assert(
    checkpointProgress.rows[0]?.best_score === 95 &&
      checkpointProgress.rows[0]?.best_attempt_id === acceptedAcrossCheckpoint.rows[0].id,
    `${label}: a passed checkpoint did not unlock the next chapter`,
  )
}

async function reapplyCurriculumData(migrations, label) {
  const seed = migrations.find(({ name }) => name === 'curriculum_seed')
  const backfill = migrations.find(({ name }) => name === 'path_preferences_backfill')
  assert(seed && backfill, `${label}: curriculum data migrations are missing`)
  await applyMigration(client, seed)
  await applyMigration(client, backfill)
  await assertCurriculumCoverage(`${label} reapplied`)
}

async function reproduceProductionDefaultTablePrivileges() {
  await client.query(`
    grant all privileges on table
      public.practice_paths,
      public.practice_chapters,
      public.practice_lessons,
      public.profile_path_preferences,
      public.lesson_progress,
      public.practice_activity_days
    to anon, authenticated, service_role;

    revoke insert, update, delete on table
      public.profile_path_preferences,
      public.lesson_progress,
      public.practice_activity_days
    from public, anon, authenticated;
  `)
}

async function assertProductionGrantMismatchFixture(label) {
  const mismatch = await client.query(`select
    has_table_privilege('anon', 'public.practice_paths', 'TRUNCATE')
      as anonymous_curriculum_truncate,
    has_table_privilege('authenticated', 'public.practice_paths', 'UPDATE')
      as authenticated_curriculum_update,
    has_table_privilege('anon', 'public.profile_path_preferences', 'SELECT')
      as anonymous_preference_select,
    has_table_privilege('service_role', 'public.practice_activity_days', 'DELETE')
      as service_activity_delete,
    has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
      as anonymous_signup_trigger_execute`)
  assert(
    Object.values(mismatch.rows[0] ?? {}).every((value) => value === true),
    `${label}: Production grant mismatch fixture did not reproduce`,
  )
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
  await assertV3Progression('fresh')
  await assertActivitySecurity('fresh')
  await reapplyCurriculumData(migrations, 'fresh')
  await assertGrantHardening('fresh')
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
  await assertV3Progression('upgrade')
  await assertActivitySecurity('upgrade')
  await assertGrantHardening('upgrade')
  console.log('pass original-four upgrade chain')
}

async function runPreCurriculumUpgrade(migrations) {
  await bootstrapSupabaseSurface()
  const preCurriculum = migrations.slice(0, 9)
  const curriculum = migrations.slice(9, 12)
  const phase5 = migrations.slice(12, 13)
  const hardening = migrations.slice(13, 14)
  const v3Progression = migrations.slice(14, 17)
  const userDataDeletion = migrations.slice(17)
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
  assert(
    JSON.stringify(hardening.map(({ name }) => name)) ===
      JSON.stringify(['curriculum_grant_hardening']),
    'expected exactly one curriculum grant-hardening migration',
  )
  assert(
    JSON.stringify(v3Progression.map(({ name }) => name)) ===
      JSON.stringify([
        'v3_progression_compatibility',
        'v3_score_2_progression_compatibility',
        'current_v3_score_2_progression',
      ]),
    'expected both compatibility migrations and the current-only cleanup',
  )
  assert(
    JSON.stringify(userDataDeletion.map(({ name }) => name)) ===
      JSON.stringify(['user_data_deletion']),
    'expected exactly one user-data deletion migration',
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
  await reapplyCurriculumData(migrations, 'pre-curriculum')
  await applyAll(phase5)
  await assertActivitySecurity('pre-curriculum')
  await applyAll(hardening)
  await applyAll(v3Progression)
  await applyAll(userDataDeletion)
  await assertCurriculumSecurity('pre-curriculum')
  await assertV3Progression('pre-curriculum')
  await assertGrantHardening('pre-curriculum')
  console.log('pass nine-migration pre-curriculum upgrade chain')
}

async function runPrePhase5Upgrade(migrations) {
  await bootstrapSupabaseSurface()
  const prePhase5 = migrations.slice(0, 12)
  const phase5 = migrations.slice(12, 13)
  const hardening = migrations.slice(13, 14)
  const v3Progression = migrations.slice(14, 17)
  const userDataDeletion = migrations.slice(17)
  assert(
    prePhase5.at(-1)?.name === 'path_preferences_backfill',
    'pre-Phase-5 boundary must include the curriculum preference backfill',
  )
  assert(
    JSON.stringify(phase5.map(({ name }) => name)) === JSON.stringify(['practice_activity']),
    'pre-Phase-5 upgrade must add only practice activity',
  )
  assert(
    JSON.stringify(hardening.map(({ name }) => name)) ===
      JSON.stringify(['curriculum_grant_hardening']),
    'pre-Phase-5 upgrade must end with curriculum grant hardening',
  )
  assert(
    JSON.stringify(v3Progression.map(({ name }) => name)) ===
      JSON.stringify([
        'v3_progression_compatibility',
        'v3_score_2_progression_compatibility',
        'current_v3_score_2_progression',
      ]),
    'pre-Phase-5 upgrade must end with compatibility and current-only progression',
  )
  assert(
    JSON.stringify(userDataDeletion.map(({ name }) => name)) ===
      JSON.stringify(['user_data_deletion']),
    'pre-Phase-5 upgrade must end with user-data deletion support',
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
  await applyAll(hardening)
  await applyAll(v3Progression)
  await applyAll(userDataDeletion)
  await assertCurriculumSecurity('pre-Phase-5')
  await assertV3Progression('pre-Phase-5')
  await assertGrantHardening('pre-Phase-5')
  console.log('pass exact pre-Phase-5 upgrade chain')
}

async function runGrantHardeningUpgrade(migrations) {
  await bootstrapSupabaseSurface()
  const currentProduction = migrations.slice(0, 13)
  const hardening = migrations.slice(13, 14)
  const v3Progression = migrations.slice(14, 17)
  const userDataDeletion = migrations.slice(17)
  assert(
    currentProduction.at(-1)?.name === 'practice_activity',
    'grant-hardening upgrade must start from the exact 13-migration state',
  )
  assert(
    JSON.stringify(hardening.map(({ name }) => name)) ===
      JSON.stringify(['curriculum_grant_hardening']),
    'grant-hardening upgrade must apply only the new security migration',
  )
  assert(
    JSON.stringify(v3Progression.map(({ name }) => name)) ===
      JSON.stringify([
        'v3_progression_compatibility',
        'v3_score_2_progression_compatibility',
        'current_v3_score_2_progression',
      ]),
    'grant-hardening upgrade must be followed by compatibility and current-only progression',
  )
  assert(
    JSON.stringify(userDataDeletion.map(({ name }) => name)) ===
      JSON.stringify(['user_data_deletion']),
    'grant-hardening upgrade must end with user-data deletion support',
  )

  await seedAuthUser(USERS.missingProfile, 'Hardening Upgrade General')
  await seedAuthUser(USERS.owner, 'Hardening Upgrade Owner')
  await seedAuthUser(USERS.other, 'Hardening Upgrade Other')
  await applyAll(currentProduction)
  await reproduceProductionDefaultTablePrivileges()
  await assertProductionGrantMismatchFixture('grant-hardening upgrade')

  await applyAll(hardening)
  const existingLesson = await client.query(`
    select lesson.id, lesson.prompt_id, path.mode
    from public.practice_lessons as lesson
    join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
    join public.practice_paths as path on path.id = chapter.path_id
    where path.slug = 'general-speaking'
    order by chapter.position, lesson.position
    limit 1
  `)
  const target = existingLesson.rows[0]
  assert(target, 'grant-hardening upgrade: v3 replay lesson is missing')
  const existingV3 = await client.query(
    `insert into public.attempts (
       user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
       prompt_difficulty, rubric_version, status, finished_at, score, section_scores
     ) values ($1, $2, $3, 'Pre-migration v3 result', $4, 'library', 'beginner',
       'v3', 'done', '2026-09-03T09:59:00Z', 92, $5::jsonb)
     returning id`,
    [
      USERS.missingProfile,
      target.prompt_id,
      target.id,
      target.mode,
      JSON.stringify(structuredV3ScorePayload(target.mode, 92)),
    ],
  )
  const beforeV3Compatibility = await client.query(
    `select count(*)::integer as count from public.lesson_progress
     where user_id = $1 and lesson_id = $2`,
    [USERS.missingProfile, target.id],
  )
  assert(
    beforeV3Compatibility.rows[0]?.count === 0,
    'grant-hardening upgrade: the v2-only trigger unexpectedly accepted v3',
  )

  await applyAll(v3Progression)
  const progressBeforeReplay = await client.query(
    `select row_to_json(progress)::text as snapshot
     from public.lesson_progress as progress
     order by progress.user_id, progress.lesson_id`,
  )
  await applyMigration(client, v3Progression.at(-1))
  const progressAfterReplay = await client.query(
    `select row_to_json(progress)::text as snapshot
     from public.lesson_progress as progress
     order by progress.user_id, progress.lesson_id`,
  )
  assert(
    JSON.stringify(progressAfterReplay.rows) === JSON.stringify(progressBeforeReplay.rows),
    'grant-hardening upgrade: current cleanup replay was not idempotent',
  )
  await applyAll(userDataDeletion)
  const replayedV3 = await client.query(
    `select best_score, best_attempt_id from public.lesson_progress
     where user_id = $1 and lesson_id = $2`,
    [USERS.missingProfile, target.id],
  )
  assert(
    replayedV3.rows[0]?.best_score === 92 &&
      replayedV3.rows[0]?.best_attempt_id === existingV3.rows[0]?.id,
    'grant-hardening upgrade: the pending migration did not replay an existing valid v3 result',
  )
  await assertCurriculumCoverage('grant-hardening upgrade')
  await assertCurriculumSecurity('grant-hardening upgrade')
  await assertV3Progression('grant-hardening upgrade')
  await assertActivitySecurity('grant-hardening upgrade')
  await assertGrantHardening('grant-hardening upgrade')

  console.log('pass exact 13-migration Production grant-hardening upgrade')
}

async function runCurrentBoundaryUpgrade(migrations, boundaryName, label) {
  await bootstrapSupabaseSurface()
  const boundaryIndex = migrations.findIndex(({ name }) => name === boundaryName)
  assert(boundaryIndex >= 0, `${label}: boundary migration is missing`)
  await applyAll(migrations.slice(0, boundaryIndex + 1))
  await seedAuthUser(USERS.owner, `${label} owner`)
  await seedAuthUser(USERS.other, `${label} threshold owner`)

  const lessons = await client.query(`
    select lesson.id, lesson.prompt_id, path.mode, chapter.level as difficulty
    from public.practice_lessons as lesson
    join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
    join public.practice_paths as path on path.id = chapter.path_id
    where path.slug = 'general-speaking'
    order by chapter.position, lesson.position
    limit 2
  `)
  assert(lessons.rowCount === 2, `${label}: lesson fixtures are missing`)
  const [first, second] = lessons.rows

  const insertVersioned = async (
    lesson,
    rubricVersion,
    score,
    payload,
    finishedAt,
    userId = USERS.owner,
  ) =>
    client.query(
      `insert into public.attempts (
         user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
         prompt_difficulty, rubric_version, status, finished_at, score, section_scores
       ) values ($1, $2, $3, $4, $5, 'library', $6, $7, 'done', $8, $9, $10::jsonb)
       returning id`,
      [
        userId,
        lesson.prompt_id,
        lesson.id,
        `${label} immutable snapshot`,
        lesson.mode,
        lesson.difficulty,
        rubricVersion,
        finishedAt,
        score,
        JSON.stringify(payload),
      ],
    )

  await insertVersioned(
    first,
    'v2',
    99,
    structuredScorePayload(first.mode, 99),
    '2026-09-01T09:00:00Z',
  )
  await insertVersioned(
    first,
    'v3',
    98,
    structuredLegacyV3ScorePayload(first.mode, 98),
    '2026-09-03T09:00:00Z',
  )
  const currentFirst = await insertVersioned(
    first,
    'v3',
    92,
    structuredV3ScorePayload(first.mode, 92),
    '2026-09-04T09:00:00Z',
  )
  const currentSecond = await insertVersioned(
    second,
    'v3',
    91,
    structuredV3ScorePayload(second.mode, 91),
    '2026-09-04T09:01:00Z',
  )
  await insertVersioned(
    first,
    'v2',
    99,
    structuredScorePayload(first.mode, 99),
    '2026-09-01T10:00:00Z',
    USERS.other,
  )
  const belowThresholdFirst = await insertVersioned(
    first,
    'v3',
    69,
    structuredV3ScorePayload(first.mode, 69),
    '2026-09-04T10:00:00Z',
    USERS.other,
  )
  await insertVersioned(
    second,
    'v3',
    91,
    structuredV3ScorePayload(second.mode, 91),
    '2026-09-04T10:01:00Z',
    USERS.other,
  )

  const beforeAttempts = await client.query(
    `select row_to_json(attempt)::text as snapshot
     from public.attempts as attempt
     where attempt.user_id = any($1::uuid[])
     order by attempt.id`,
    [[USERS.owner, USERS.other]],
  )
  await applyAll(migrations.slice(boundaryIndex + 1))
  const afterAttempts = await client.query(
    `select row_to_json(attempt)::text as snapshot
     from public.attempts as attempt
     where attempt.user_id = any($1::uuid[])
     order by attempt.id`,
    [[USERS.owner, USERS.other]],
  )
  assert(
    JSON.stringify(afterAttempts.rows) === JSON.stringify(beforeAttempts.rows),
    `${label}: cleanup rewrote immutable attempt rows`,
  )

  const rebuilt = await client.query(
    `select user_id, lesson_id, best_score, best_attempt_id
     from public.lesson_progress
     where user_id = any($1::uuid[])
     order by user_id, lesson_id`,
    [[USERS.owner, USERS.other]],
  )
  assert(
    rebuilt.rowCount === 3 &&
      rebuilt.rows.some(
        (row) =>
          row.user_id === USERS.owner &&
          row.lesson_id === first.id &&
          row.best_score === 92 &&
          row.best_attempt_id === currentFirst.rows[0].id,
      ) &&
      rebuilt.rows.some(
        (row) =>
          row.user_id === USERS.owner &&
          row.lesson_id === second.id &&
          row.best_score === 91 &&
          row.best_attempt_id === currentSecond.rows[0].id,
      ) &&
      rebuilt.rows.some(
        (row) =>
          row.user_id === USERS.other &&
          row.lesson_id === first.id &&
          row.best_score === 69 &&
          row.best_attempt_id === belowThresholdFirst.rows[0].id,
      ) &&
      !rebuilt.rows.some(
        (row) =>
          row.user_id === USERS.other && row.lesson_id === second.id && row.best_score === 91,
      ),
    `${label}: cleanup did not rebuild current-only sequential bests`,
  )
  await assertNoteFeedbackSecurity(label)
  await assertGrantHardening(label)
  console.log(`pass ${label}`)
}

async function runUserDataDeletionOperations(migrations) {
  await bootstrapSupabaseSurface()
  await applyAll(migrations)
  await seedAuthUser(USERS.deletion, 'Deletion Owner')
  await seedAuthUser(USERS.deletionOther, 'Deletion Other')

  const lessons = await client.query(`
    select lesson.id, lesson.prompt_id, path.mode, chapter.level as difficulty
    from public.practice_lessons as lesson
    join public.practice_chapters as chapter on chapter.id = lesson.chapter_id
    join public.practice_paths as path on path.id = chapter.path_id
    where path.slug = 'general-speaking'
    order by chapter.position, lesson.position
    limit 3
  `)
  assert(lessons.rowCount === 3, 'deletion: lesson fixtures are missing')
  const [first, second, third] = lessons.rows

  const insertScored = async (userId, lesson, score, finishedAt, retryOf = null) =>
    client.query(
      `insert into public.attempts (
         user_id, prompt_id, lesson_id, prompt_text, practice_mode, prompt_source,
         prompt_difficulty, rubric_version, retry_of_attempt_id, status, finished_at,
         duration_ms, transcript, score, section_scores
       ) values ($1, $2, $3, 'Deletion fixture', $4, 'library', $5, 'v3', $6,
         'done', $7, 30000, 'A complete speaking response.', $8, $9::jsonb)
       returning id`,
      [
        userId,
        lesson.prompt_id,
        lesson.id,
        lesson.mode,
        lesson.difficulty,
        retryOf,
        finishedAt,
        score,
        JSON.stringify(structuredV3ScorePayload(lesson.mode, score)),
      ],
    )

  const attempt72 = await insertScored(USERS.deletion, first, 72, '2026-09-05T12:00:00Z')
  const attempt88 = await insertScored(USERS.deletion, first, 88, '2026-09-05T12:01:00Z')
  const attempt81 = await insertScored(USERS.deletion, first, 81, '2026-09-05T12:02:00Z')
  const attempt85 = await insertScored(USERS.deletion, second, 85, '2026-09-05T12:03:00Z')
  const attempt90 = await insertScored(USERS.deletion, third, 90, '2026-09-05T12:04:00Z')
  const otherAttempt = await insertScored(USERS.deletionOther, first, 91, '2026-09-06T12:00:00Z')
  const neutralAttempt = await insertScored(USERS.deletion, first, null, '2026-09-05T12:05:00Z')
  await client.query('update public.attempts set section_scores = $1::jsonb where id = $2', [
    JSON.stringify(neutralV3ScorePayload(first.mode, 80)),
    neutralAttempt.rows[0].id,
  ])
  const malformedNeutral = await insertScored(USERS.deletion, first, null, '2026-09-05T12:06:00Z')
  const malformedNeutralPayload = neutralV3ScorePayload(first.mode, 80)
  malformedNeutralPayload.total_max_points = 99
  await client.query('update public.attempts set section_scores = $1::jsonb where id = $2', [
    JSON.stringify(malformedNeutralPayload),
    malformedNeutral.rows[0].id,
  ])
  const terminalAttempts = await client.query(
    `insert into public.attempts (
       user_id, prompt_id, prompt_text, practice_mode, prompt_source,
       prompt_difficulty, rubric_version, status, failure_code, finished_at
     ) values
       ($1, $2, 'Failed deletion fixture', $3, 'library', $4, 'v3',
        'failed', 'recording_failed', '2026-09-05T12:07:00Z'),
       ($1, $2, 'Timed out deletion fixture', $3, 'library', $4, 'v3',
        'timed_out', 'recording_timed_out', '2026-09-05T12:08:00Z')
     returning id, status`,
    [USERS.deletion, first.prompt_id, first.mode, first.difficulty],
  )
  await client.query(
    `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
     values ($1, $2, 'answered', null)`,
    [USERS.deletion, attempt81.rows[0].id],
  )

  await client.query('set role service_role')
  for (const attemptId of [
    attempt72.rows[0].id,
    attempt88.rows[0].id,
    attempt81.rows[0].id,
    attempt85.rows[0].id,
    attempt90.rows[0].id,
    otherAttempt.rows[0].id,
    neutralAttempt.rows[0].id,
  ]) {
    const userId = attemptId === otherAttempt.rows[0].id ? USERS.deletionOther : USERS.deletion
    const recorded = await client.query(
      'select public.record_practice_activity_for_attempt($1, $2) as recorded',
      [userId, attemptId],
    )
    assert(recorded.rows[0]?.recorded === true, 'deletion: activity recording failed')
  }
  const malformedActivity = await client.query(
    'select public.record_practice_activity_for_attempt($1, $2) as recorded',
    [USERS.deletion, malformedNeutral.rows[0].id],
  )
  assert(
    malformedActivity.rows[0]?.recorded === false,
    'deletion: malformed neutral result counted as activity',
  )

  for (const terminal of terminalAttempts.rows) {
    const terminalDelete = await client.query(
      'select * from public.delete_owned_attempt_and_rebuild($1, $2)',
      [USERS.deletion, terminal.id],
    )
    assert(terminalDelete.rows[0]?.deleted === true, `deletion: ${terminal.status} row remained`)
  }

  const wrongOwner = await client.query(
    'select * from public.delete_owned_attempt_and_rebuild($1, $2)',
    [USERS.deletion, otherAttempt.rows[0].id],
  )
  assert(wrongOwner.rows[0]?.deleted === false, 'deletion: ownership boundary deleted a row')

  const nonBest = await client.query(
    'select * from public.delete_owned_attempt_and_rebuild($1, $2)',
    [USERS.deletion, attempt81.rows[0].id],
  )
  assert(
    nonBest.rows[0]?.deleted === true && nonBest.rows[0]?.best_attempt_id === attempt88.rows[0].id,
    'deletion: non-best deletion changed the redirect best',
  )
  const deletedFeedback = await client.query(
    'select count(*)::integer as count from public.note_feedback where attempt_id = $1',
    [attempt81.rows[0].id],
  )
  assert(deletedFeedback.rows[0]?.count === 0, 'deletion: attempt feedback did not cascade')
  const promoted = await client.query(
    'select * from public.delete_owned_attempt_and_rebuild($1, $2)',
    [USERS.deletion, attempt88.rows[0].id],
  )
  assert(
    promoted.rows[0]?.best_attempt_id === attempt72.rows[0].id,
    'deletion: next surviving best was not promoted',
  )
  const promotedProgress = await client.query(
    `select best_score, best_attempt_id from public.lesson_progress
     where user_id = $1 and lesson_id = $2`,
    [USERS.deletion, first.id],
  )
  assert(
    promotedProgress.rows[0]?.best_score === 72 &&
      promotedProgress.rows[0]?.best_attempt_id === attempt72.rows[0].id,
    'deletion: durable best did not move downward to the surviving attempt',
  )

  const lastScored = await client.query(
    'select * from public.delete_owned_attempt_and_rebuild($1, $2)',
    [USERS.deletion, attempt72.rows[0].id],
  )
  assert(
    lastScored.rows[0]?.best_attempt_id === neutralAttempt.rows[0].id,
    'deletion: provider-neutral same-lesson survivor was not selected for redirect',
  )
  const relocked = await client.query(
    `select lesson_id from public.lesson_progress
     where user_id = $1 and lesson_id = any($2::uuid[])`,
    [USERS.deletion, [first.id, second.id, third.id]],
  )
  assert(relocked.rowCount === 0, 'deletion: downstream progression was not re-locked')
  const laterAttempts = await client.query(
    'select id from public.attempts where id = any($1::uuid[])',
    [[attempt85.rows[0].id, attempt90.rows[0].id]],
  )
  assert(laterAttempts.rowCount === 2, 'deletion: later attempts were incorrectly deleted')
  const retainedDay = await client.query(
    'select local_date from public.practice_activity_days where user_id = $1',
    [USERS.deletion],
  )
  assert(retainedDay.rowCount === 1, 'deletion: shared activity day was removed')

  await client.query('select * from public.delete_owned_attempt_and_rebuild($1, $2)', [
    USERS.deletionOther,
    otherAttempt.rows[0].id,
  ])
  const removedOnlyDay = await client.query(
    'select local_date from public.practice_activity_days where user_id = $1',
    [USERS.deletionOther],
  )
  assert(removedOnlyDay.rowCount === 0, 'deletion: unsupported activity day remained')

  await client.query('reset role')
  const repass = await insertScored(USERS.deletion, first, 95, '2026-09-07T12:00:00Z')
  const restored = await client.query(
    `select lesson_id, best_score from public.lesson_progress
     where user_id = $1 and lesson_id = any($2::uuid[])
     order by lesson_id`,
    [USERS.deletion, [first.id, second.id, third.id]],
  )
  assert(
    restored.rowCount === 3 &&
      restored.rows.some((row) => row.lesson_id === first.id && row.best_score === 95) &&
      restored.rows.some((row) => row.lesson_id === second.id && row.best_score === 85) &&
      restored.rows.some((row) => row.lesson_id === third.id && row.best_score === 90),
    'deletion: a new prerequisite pass did not restore surviving downstream progress',
  )

  const retry = await insertScored(
    USERS.deletion,
    first,
    80,
    '2026-09-07T12:01:00Z',
    repass.rows[0].id,
  )
  await client.query('set role service_role')
  await client.query('select * from public.delete_owned_attempt_and_rebuild($1, $2)', [
    USERS.deletion,
    repass.rows[0].id,
  ])
  const repairedRetry = await client.query(
    'select retry_of_attempt_id from public.attempts where id = $1',
    [retry.rows[0].id],
  )
  assert(
    repairedRetry.rows[0]?.retry_of_attempt_id === null,
    'deletion: surviving retry parent was not repaired',
  )

  const finalizedRecordingPath = `${USERS.deletion}/${retry.rows[0].id}.webm`
  await client.query(
    `update public.attempts
     set audio_path = $1,
       metrics = jsonb_build_object(
         'upload', jsonb_build_object(
           'storage_path', $1::text,
           'mime_type', 'audio/webm;codecs=opus'
         )
       )
     where id = $2`,
    [finalizedRecordingPath, retry.rows[0].id],
  )
  const uploadOnly = await client.query(
    `insert into public.attempts (
       user_id, prompt_id, prompt_text, practice_mode, prompt_source,
       prompt_difficulty, rubric_version, status, failure_code, finished_at
     ) values ($1, $2, 'Upload-only reset fixture', $3, 'library', $4, 'v3',
       'failed', 'recording_failed', '2026-09-07T12:02:00Z')
     returning id`,
    [USERS.deletion, first.prompt_id, first.mode, first.difficulty],
  )
  const uploadOnlyPath = `${USERS.deletion}/${uploadOnly.rows[0].id}.webm`
  await client.query(
    `update public.attempts
     set metrics = jsonb_build_object(
       'upload', jsonb_build_object(
         'storage_path', $1::text,
         'mime_type', 'audio/webm;codecs=opus'
       )
     )
     where id = $2`,
    [uploadOnlyPath, uploadOnly.rows[0].id],
  )

  await client.query('reset role')
  await setAuthenticatedUser(USERS.deletion)
  const resetReceipt = await client.query('select * from public.reset_my_progress()')
  assert(resetReceipt.rows[0]?.attempts_deleted >= 1, 'reset: attempt count was not returned')
  const resetClaims = resetReceipt.rows[0]?.recording_claims
  assert(
    Array.isArray(resetClaims) &&
      resetClaims.length === Number(resetReceipt.rows[0]?.attempts_deleted) &&
      resetClaims.some((claim) => claim.audio_path === finalizedRecordingPath) &&
      resetClaims.some(
        (claim) =>
          claim.audio_path === null && claim.metrics?.upload?.storage_path === uploadOnlyPath,
      ),
    'reset: exact finalized and upload-only recording claims were not returned',
  )
  await client.query('reset role')
  const resetState = await client.query(
    `select
       (select count(*)::integer from public.attempts where user_id = $1) as attempts,
       (select count(*)::integer from public.lesson_progress where user_id = $1) as progress,
       (select count(*)::integer from public.practice_activity_days where user_id = $1) as activity,
       (select count(*)::integer from public.note_feedback where user_id = $1) as feedback,
       (select count(*)::integer from public.profiles where id = $1) as profiles,
       (select count(*)::integer from public.profile_path_preferences where user_id = $1) as preferences,
       (select count(*)::integer from auth.users where id = $1) as auth_users`,
    [USERS.deletion],
  )
  assert(
    JSON.stringify(resetState.rows[0]) ===
      JSON.stringify({
        attempts: 0,
        progress: 0,
        activity: 0,
        feedback: 0,
        profiles: 1,
        preferences: 1,
        auth_users: 1,
      }),
    'reset: fresh-user data boundary changed',
  )
  await setAuthenticatedUser(USERS.deletion)
  const repeatedReset = await client.query('select * from public.reset_my_progress()')
  assert(
    repeatedReset.rows[0]?.attempts_deleted === '0' ||
      repeatedReset.rows[0]?.attempts_deleted === 0n ||
      repeatedReset.rows[0]?.attempts_deleted === 0,
    'reset: repeated reset was not idempotent',
  )
  await resetRole()

  const otherStillExists = await client.query(
    'select count(*)::integer as count from auth.users where id = $1',
    [USERS.deletionOther],
  )
  assert(otherStillExists.rows[0]?.count === 1, 'reset: another user was affected')

  const cascadeAttempt = await insertScored(USERS.deletionOther, first, 93, '2026-09-08T12:00:00Z')
  await client.query(
    `insert into public.note_feedback (user_id, attempt_id, note_type, quote)
     values ($1, $2, 'answered', null)`,
    [USERS.deletionOther, cascadeAttempt.rows[0].id],
  )
  await client.query(
    `insert into public.practice_activity_days (user_id, local_date, timezone)
     values ($1, '2026-09-08', 'UTC')
     on conflict (user_id, local_date) do nothing`,
    [USERS.deletionOther],
  )
  await client.query('delete from auth.users where id = $1', [USERS.deletionOther])
  const cascadeState = await client.query(
    `select
       (select count(*)::integer from public.attempts where user_id = $1) as attempts,
       (select count(*)::integer from public.lesson_progress where user_id = $1) as progress,
       (select count(*)::integer from public.practice_activity_days where user_id = $1) as activity,
       (select count(*)::integer from public.note_feedback where user_id = $1) as feedback,
       (select count(*)::integer from public.profiles where id = $1) as profiles,
       (select count(*)::integer from public.profile_path_preferences where user_id = $1) as preferences`,
    [USERS.deletionOther],
  )
  assert(
    Object.values(cascadeState.rows[0]).every((count) => count === 0),
    'deletion: Auth deletion did not cascade through every audited application table',
  )
  const resetOwnerStillExists = await client.query(
    'select count(*)::integer as count from auth.users where id = $1',
    [USERS.deletion],
  )
  assert(resetOwnerStillExists.rows[0]?.count === 1, 'deletion: another Auth user was affected')
  console.log('pass user-data deletion operations')
}

try {
  await client.connect()
  const migrations = loadMigrations()
  assert(
    migrations.length === 18,
    'Expected nine production, three curriculum, one Phase 5, one hardening, two compatibility migrations, one current-only cleanup, and one user-data deletion migration.',
  )
  await runFresh(migrations)
  await runUpgrade(migrations)
  await runPreCurriculumUpgrade(migrations)
  await runPrePhase5Upgrade(migrations)
  await runGrantHardeningUpgrade(migrations)
  await runCurrentBoundaryUpgrade(migrations, 'curriculum_grant_hardening', 'pre-v3 upgrade')
  await runCurrentBoundaryUpgrade(
    migrations,
    'v3_progression_compatibility',
    'v3.score.1 intermediate upgrade',
  )
  await runUserDataDeletionOperations(migrations)
  await runCurrentBoundaryUpgrade(
    migrations,
    'v3_score_2_progression_compatibility',
    'v3.score.2 compatibility upgrade',
  )
  console.log('Migration integration harness passed.')
} catch (error) {
  console.error(`Migration integration harness failed: ${error.stack ?? error.message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
