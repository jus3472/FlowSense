/** Read-only comparison of repository migrations with a database ledger. */
import pg from 'pg'
import {
  compareMigrationLedger,
  databaseClientOptions,
  loadEnvFile,
  loadMigrations,
  readMigrationLedger,
} from './lib/migrations.mjs'

loadEnvFile('.env.local')

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL is not set. Preflight did not connect to a database.')
  process.exit(1)
}

const client = new pg.Client(databaseClientOptions(connectionString))
try {
  await client.connect()
  await client.query('begin read only')
  const recorded = await readMigrationLedger(client)
  await client.query('rollback')

  if (recorded === null) {
    console.error('Migration ledger is missing. Every repository migration is pending.')
    for (const migration of loadMigrations()) console.error(`missing     ${migration.fileName}`)
    process.exitCode = 1
  } else {
    const comparison = compareMigrationLedger(loadMigrations(), recorded)
    for (const fileName of comparison.missing) console.error(`missing     ${fileName}`)
    for (const version of comparison.unexpected) console.error(`unexpected  ${version}`)

    if (comparison.missing.length > 0 || comparison.unexpected.length > 0) {
      process.exitCode = 1
    } else {
      console.log(`Migration preflight passed. ${recorded.length} migration(s) are in sync.`)
    }
  }
} catch (error) {
  try {
    await client.query('rollback')
  } catch {
    // The connection may have failed before the read-only transaction began.
  }
  console.error(`Migration preflight failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
