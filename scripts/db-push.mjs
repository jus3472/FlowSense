import pg from 'pg'
import {
  applyMigration,
  databaseClientOptions,
  ensureMigrationLedger,
  isMigrationApplied,
  loadEnvFile,
  loadMigrations,
  readMigrationLedger,
} from './lib/migrations.mjs'

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

const client = new pg.Client(databaseClientOptions(connectionString))
await client.connect()

await ensureMigrationLedger(client)
const applied = new Set((await readMigrationLedger(client)) ?? [])
const migrations = loadMigrations()

let count = 0
for (const migration of migrations) {
  if (isMigrationApplied(migration, applied)) {
    console.log(`skip  ${migration.fileName}`)
    continue
  }

  try {
    await applyMigration(client, migration, { record: true })
    console.log(`apply ${migration.fileName}`)
    count += 1
  } catch (error) {
    console.error(`\n${error.message}`)
    await client.end()
    process.exit(1)
  }
}

await client.end()
console.log(`\n${count} migration(s) applied, ${migrations.length - count} already up to date.`)
