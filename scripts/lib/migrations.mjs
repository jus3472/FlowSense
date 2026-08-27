import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export const MIGRATIONS_DIR = 'supabase/migrations'

const MIGRATION_NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/
const DISPOSABLE_DATABASE_NAME = /(?:^|[_-])(test|testing|scratch|disposable)(?:[_-]|$)/i
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const DATABASE_TLS_PARAMETERS = [
  'ssl',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'sslnegotiation',
]

function databaseIdentity(connectionString) {
  const parsed = new URL(connectionString)
  const port = parsed.port || '5432'
  return `${parsed.hostname.toLowerCase()}:${port}/${decodeURIComponent(parsed.pathname.replace(/^\//, ''))}`
}

export function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key]) continue
      process.env[key] = rawValue.replace(/^["']|["']$/g, '')
    }
  } catch {
    // Callers decide whether a missing environment value is an error.
  }
}

export function parseMigrationName(fileName) {
  const match = MIGRATION_NAME.exec(fileName)
  if (!match) throw new Error(`Invalid migration filename: ${fileName}`)
  const [, version, name] = match
  return {
    fileName,
    version,
    name,
    legacyVersion: fileName.replace(/\.sql$/, ''),
  }
}

export function loadMigrations(root = process.cwd()) {
  const directory = resolve(root, MIGRATIONS_DIR)
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()
    .map((fileName) => ({
      ...parseMigrationName(fileName),
      path: join(directory, fileName),
      sql: readFileSync(join(directory, fileName), 'utf8'),
    }))
}

export function compareMigrationLedger(migrations, recordedVersions) {
  const recorded = new Set(recordedVersions.map(String))
  const known = new Set()
  const missing = []

  for (const migration of migrations) {
    known.add(migration.version)
    known.add(migration.legacyVersion)
    if (!recorded.has(migration.version) && !recorded.has(migration.legacyVersion)) {
      missing.push(migration.fileName)
    }
  }

  return {
    missing,
    unexpected: [...recorded].filter((version) => !known.has(version)).sort(),
  }
}

export function isMigrationApplied(migration, recordedVersions) {
  return recordedVersions.has(migration.version) || recordedVersions.has(migration.legacyVersion)
}

export function databaseClientOptions(connectionString) {
  const parsed = new URL(connectionString)
  const local = LOCAL_HOSTS.has(parsed.hostname)

  if (local) {
    // pg lets connection-string TLS parameters override the top-level option.
    // Remove them so disposable loopback databases always remain non-TLS.
    for (const parameter of DATABASE_TLS_PARAMETERS) parsed.searchParams.delete(parameter)
    return { connectionString: parsed.toString(), ssl: false }
  }

  const hasExplicitTlsConfiguration = DATABASE_TLS_PARAMETERS.some((parameter) =>
    parsed.searchParams.has(parameter),
  )

  if (hasExplicitTlsConfiguration) {
    // Let pg honor explicit modes such as sslmode=verify-full, including a
    // caller-supplied sslrootcert. No connection details are logged here.
    return { connectionString }
  }

  // Hosted Supabase can present a certificate chain that is not in Node's
  // trust store. Preserve the established encrypted-but-unverified database
  // connection behavior unless the URL explicitly requests stricter TLS.
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
  }
}

export function assertDisposableDatabaseUrl(
  connectionString,
  {
    liveConnectionString = process.env.SUPABASE_DB_URL,
    remoteConfirmation = process.env.FLOWSENSE_MIGRATION_TEST_ALLOW_REMOTE,
  } = {},
) {
  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new Error('FLOWSENSE_MIGRATION_TEST_URL must be a valid PostgreSQL URL.')
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Migration tests require a PostgreSQL URL.')
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!databaseName || !DISPOSABLE_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      'Migration test database name must include test, testing, scratch, or disposable.',
    )
  }

  if (
    liveConnectionString &&
    databaseIdentity(connectionString) === databaseIdentity(liveConnectionString)
  ) {
    throw new Error('Migration tests refuse to use SUPABASE_DB_URL.')
  }

  if (
    !LOCAL_HOSTS.has(parsed.hostname) &&
    remoteConfirmation !== 'I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE'
  ) {
    throw new Error(
      'Remote migration tests require FLOWSENSE_MIGRATION_TEST_ALLOW_REMOTE=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE.',
    )
  }

  return parsed
}

export async function ensureMigrationLedger(client) {
  await client.query('create schema if not exists supabase_migrations')
  await client.query(`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      name text,
      statements text[]
    )
  `)
  await client.query(
    'alter table supabase_migrations.schema_migrations add column if not exists name text',
  )
  await client.query(
    'alter table supabase_migrations.schema_migrations add column if not exists statements text[]',
  )
}

export async function readMigrationLedger(client) {
  const exists = await client.query(`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'supabase_migrations'
        and table_name = 'schema_migrations'
    ) as present
  `)
  if (!exists.rows[0]?.present) return null
  const result = await client.query(
    'select version::text as version from supabase_migrations.schema_migrations order by version',
  )
  return result.rows.map((row) => String(row.version))
}

export async function applyMigration(client, migration, { record = false } = {}) {
  await client.query('begin')
  try {
    await client.query(migration.sql)
    if (record) {
      await client.query(
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values ($1, $2, $3)
         on conflict (version) do nothing`,
        // Keep the established FlowSense ledger convention. Readers accept
        // this full stem and the Supabase CLI's timestamp-only form.
        [migration.legacyVersion, migration.name, [migration.sql]],
      )
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw new Error(`Failed on ${basename(migration.path)}: ${error.message}`, { cause: error })
  }
}
