/**
 * Applies every file in supabase/migrations to the hosted Postgres database, in
 * filename order, each inside its own transaction. Applied filenames are
 * recorded in supabase_migrations.schema_migrations, the same table the Supabase
 * CLI uses, so this script and the CLI stay interchangeable.
 *
 * Usage: set SUPABASE_DB_URL in .env.local, then `npm run db:push`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const MIGRATIONS_DIR = 'supabase/migrations'

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key]) continue
      process.env[key] = rawValue.replace(/^["']|["']$/g, '')
    }
  } catch {
    // No .env.local. The connection string may still come from the environment.
  }
}

loadEnvFile('.env.local')

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error(
    [
      'SUPABASE_DB_URL is not set.',
      '',
      'Find it in the Supabase dashboard under Project Settings, Database,',
      'Connection string, URI. Add it to .env.local as:',
      '',
      '  SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres',
      '',
      'It is only needed to run migrations and is never read by the app.',
    ].join('\n'),
  )
  process.exit(1)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

await client.query('create schema if not exists supabase_migrations')
await client.query(
  'create table if not exists supabase_migrations.schema_migrations (version text primary key, inserted_at timestamptz not null default now())',
)

const { rows } = await client.query('select version from supabase_migrations.schema_migrations')
const applied = new Set(rows.map((row) => row.version))

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()

let count = 0
for (const file of files) {
  const version = file.replace(/\.sql$/, '')
  if (applied.has(version)) {
    console.log(`skip  ${file}`)
    continue
  }

  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query(
      'insert into supabase_migrations.schema_migrations (version) values ($1) on conflict do nothing',
      [version],
    )
    await client.query('commit')
    console.log(`apply ${file}`)
    count += 1
  } catch (error) {
    await client.query('rollback')
    console.error(`\nFailed on ${file}:\n${error.message}`)
    await client.end()
    process.exit(1)
  }
}

await client.end()
console.log(`\n${count} migration(s) applied, ${files.length - count} already up to date.`)
