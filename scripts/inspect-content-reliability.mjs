/**
 * Prints aggregate content-provider reliability for recent completed attempts.
 *
 * Usage:
 *   npm run inspect:content-reliability
 *   npm run inspect:content-reliability -- 100
 *   npm run inspect:content-reliability -- --limit 100 --since 2026-08-28T02:16:28Z
 */
import pg from 'pg'
import {
  formatContentReliabilityReport,
  parseContentReliabilityOptions,
  runReadOnlyContentReliabilityInspection,
} from './lib/content-reliability.mjs'
import { databaseClientOptions, loadEnvFile } from './lib/migrations.mjs'

const USAGE = `Usage: npm run inspect:content-reliability -- [limit]
       npm run inspect:content-reliability -- --limit <1-1000> [--since <ISO-8601>]`

function safeDatabaseCode(error) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9]{5}$/.test(error.code)
  ) {
    return error.code
  }
  return 'unknown'
}

let options
try {
  options = parseContentReliabilityOptions(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The inspection options were invalid.')
  console.error(USAGE)
  process.exit(1)
}

if (options.help) {
  console.log(USAGE)
  process.exit(0)
}

loadEnvFile('.env.local')
const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL is not set. Content reliability was not inspected.')
  process.exit(1)
}

let client = null
try {
  client = new pg.Client(databaseClientOptions(connectionString))
  await client.connect()
  const summary = await runReadOnlyContentReliabilityInspection(client, options)
  console.log(formatContentReliabilityReport(summary))
} catch (error) {
  console.error(
    `Content reliability inspection failed (database code: ${safeDatabaseCode(error)}).`,
  )
  process.exitCode = 1
} finally {
  await client?.end().catch(() => undefined)
}
