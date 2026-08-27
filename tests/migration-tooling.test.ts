import { readFileSync } from 'node:fs'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import {
  applyMigration,
  assertDisposableDatabaseUrl,
  compareMigrationLedger,
  databaseClientOptions,
  loadMigrations,
  parseMigrationName,
} from '../scripts/lib/migrations.mjs'

function resolvedSsl(connectionString: string) {
  const client = new pg.Client(databaseClientOptions(connectionString))
  return Reflect.get(client, 'ssl')
}

describe('migration tooling', () => {
  it('parses timestamp and full-stem migration identifiers', () => {
    expect(parseMigrationName('20260827000100_attempt_security_foundation.sql')).toEqual({
      fileName: '20260827000100_attempt_security_foundation.sql',
      version: '20260827000100',
      name: 'attempt_security_foundation',
      legacyVersion: '20260827000100_attempt_security_foundation',
    })
    expect(() => parseMigrationName('attempt_security_foundation.sql')).toThrow(
      'Invalid migration filename',
    )
  })

  it('accepts timestamp, full-name, and mixed ledgers without false drift', () => {
    const migrations = loadMigrations()
    const fullNames = migrations.map((migration) => migration.legacyVersion)
    const timestamps = migrations.map((migration) => migration.version)
    const mixed = migrations.map((migration, index) =>
      index % 2 === 0 ? migration.version : migration.legacyVersion,
    )

    for (const ledger of [fullNames, timestamps, mixed]) {
      expect(compareMigrationLedger(migrations, ledger)).toEqual({
        missing: [],
        unexpected: [],
      })
    }
  })

  it('reports the audited four-migration ledger as missing only pending files', () => {
    const migrations = loadMigrations()
    const existingLedger = migrations.slice(0, 4).map((migration) => migration.legacyVersion)

    expect(compareMigrationLedger(migrations, existingLedger)).toEqual({
      missing: migrations.slice(4).map((migration) => migration.fileName),
      unexpected: [],
    })
  })

  it('reports unexpected ledger versions separately', () => {
    const migrations = loadMigrations()
    const comparison = compareMigrationLedger(migrations, [
      ...migrations.map((migration) => migration.version),
      '20250101000000_removed_migration',
    ])
    expect(comparison.missing).toEqual([])
    expect(comparison.unexpected).toEqual(['20250101000000_removed_migration'])
  })

  it('keeps future recording on the established full-stem convention', async () => {
    const migration = loadMigrations().at(-1)
    expect(migration).toBeDefined()
    const calls: Array<{ sql: string; parameters?: unknown[] }> = []
    const client = {
      async query(sql: string, parameters?: unknown[]) {
        calls.push({ sql, parameters })
        return { rows: [] }
      },
    }

    await applyMigration(client, migration, { record: true })
    const ledgerInsert = calls.find((call) => call.parameters?.length === 3)
    expect(ledgerInsert?.parameters?.[0]).toBe(migration?.legacyVersion)
  })

  it('fails closed unless the database URL is obviously disposable', () => {
    expect(() =>
      assertDisposableDatabaseUrl('postgresql://postgres@localhost:5432/flowsense_migration_test'),
    ).not.toThrow()
    expect(() =>
      assertDisposableDatabaseUrl('postgresql://postgres@localhost:5432/postgres'),
    ).toThrow('database name must include')
    expect(() =>
      assertDisposableDatabaseUrl('postgresql://postgres@db.example.com:5432/flowsense_test'),
    ).toThrow('Remote migration tests require')
    expect(() =>
      assertDisposableDatabaseUrl('postgresql://postgres@localhost:5432/flowsense_migration_test', {
        liveConnectionString:
          'postgresql://different-password@LOCALHOST/flowsense_migration_test?sslmode=require',
      }),
    ).toThrow('refuse to use SUPABASE_DB_URL')
  })

  it('disables TLS for loopback migration databases even when the URL requests it', () => {
    const options = databaseClientOptions(
      'postgresql://postgres@localhost:5432/flowsense_migration_test?sslmode=verify-full',
    )

    expect(options.ssl).toBe(false)
    expect(new URL(options.connectionString).searchParams.has('sslmode')).toBe(false)
    expect(resolvedSsl(options.connectionString)).toBe(false)
  })

  it('uses encrypted Supabase-compatible TLS by default without claiming CA verification', () => {
    const ssl = resolvedSsl('postgresql://postgres@db.project.supabase.co:5432/postgres')

    expect(ssl).toEqual({ rejectUnauthorized: false })
  })

  it('honors an explicit strict remote TLS mode', () => {
    const ssl = resolvedSsl(
      'postgresql://postgres@db.project.supabase.co:5432/postgres?sslmode=verify-full',
    )

    expect(ssl).toEqual({})
    expect(ssl).not.toHaveProperty('rejectUnauthorized', false)
  })

  it('keeps the preflight executable read only', () => {
    const source = readFileSync('scripts/db-preflight.mjs', 'utf8')
    expect(source).toContain("client.query('begin read only')")
    expect(source).not.toMatch(/client\.query\(['"`]\s*(create|alter|drop|insert|update|delete)/i)
    expect(source).not.toContain('applyMigration')
  })
})
