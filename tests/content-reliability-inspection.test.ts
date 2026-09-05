import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  CONTENT_RELIABILITY_QUERY,
  formatContentReliabilityReport,
  parseContentReliabilityOptions,
  runReadOnlyContentReliabilityInspection,
  summarizeContentReliability,
} from '../scripts/lib/content-reliability.mjs'

const scoreStatuses = (status: string) =>
  Object.fromEntries(
    ['answered_prompt', 'specificity', 'structure', 'conciseness', 'word_choice', 'grammar'].map(
      (metric) => [`v3_score_${metric}_status`, status],
    ),
  )

function currentRow(overrides: Record<string, unknown> = {}) {
  return {
    completed_at: '2026-09-03T03:00:00.000Z',
    score_payload_version: 'v3.score.2',
    score_rubric_version: 'v3',
    content_payload_version: 'v3.content-audit.1',
    content_evaluator_version: 'v3.content-evaluator.1',
    content_status: 'checked',
    content_calls: '1',
    ...scoreStatuses('scored'),
    ...overrides,
  }
}

describe('content reliability inspection', () => {
  it('parses a bounded default, positional limit, and completion window', () => {
    expect(parseContentReliabilityOptions([])).toEqual({ help: false, limit: 100, since: null })
    expect(parseContentReliabilityOptions(['25'])).toMatchObject({ limit: 25 })
    expect(
      parseContentReliabilityOptions(['--limit', '250', '--since', '2026-08-28T02:16:28Z']),
    ).toEqual({ help: false, limit: 250, since: '2026-08-28T02:16:28.000Z' })
    expect(() => parseContentReliabilityOptions(['0'])).toThrow('between 1 and 1000')
    expect(() => parseContentReliabilityOptions(['1001'])).toThrow('between 1 and 1000')
    expect(() => parseContentReliabilityOptions(['--since', '1'])).toThrow('valid ISO-8601')
    expect(() => parseContentReliabilityOptions(['--private-secret'])).toThrow(
      'option was not recognized',
    )
  })

  it('counts checked, provider-neutral, recovered, and malformed current content', () => {
    const summary = summarizeContentReliability([
      currentRow(),
      currentRow({ content_calls: '2', completed_at: '2026-09-03T03:01:00.000Z' }),
      currentRow({
        content_status: 'not_checked',
        content_calls: '2',
        ...scoreStatuses('not_checked'),
      }),
      currentRow({ v3_score_grammar_status: 'not_checked' }),
      currentRow({ content_payload_version: 'wrong.audit.1' }),
    ])

    expect(summary).toMatchObject({
      completedAttempts: 5,
      currentAttempts: 5,
      allSixContentMetricsScored: 2,
      allSixContentMetricsNotChecked: 1,
      malformedOrInconsistentCurrentSnapshots: 2,
      callsOne: 3,
      callsTwo: 2,
      callsOtherOrMissing: 0,
      successfulRetryRecoveries: 1,
      attemptsNeedingDiagnosticDetail: 4,
    })
    expect(summary.window).toMatchObject({
      oldestCompletedAt: '2026-09-03T03:00:00.000Z',
      newestCompletedAt: '2026-09-03T03:01:00.000Z',
    })
  })

  it('reports all non-current rows as unsupported or malformed', () => {
    const summary = summarizeContentReliability([
      { completed_at: '2026-08-27T00:00:00Z', score_payload_version: null },
      {
        completed_at: '2026-08-27T01:00:00Z',
        score_payload_version: 'future.score.1',
        score_rubric_version: 'future',
      },
      currentRow({ content_calls: 'private value' }),
    ])

    expect(summary).toMatchObject({
      completedAttempts: 3,
      currentAttempts: 1,
      unsupportedOrMalformedAttempts: 2,
      malformedOrInconsistentCurrentSnapshots: 1,
      callsOtherOrMissing: 1,
    })
  })

  it('never includes private row fields or raw diagnostic data in the aggregate report', () => {
    const privateValues = [
      'PRIVATE PROMPT SENTINEL',
      'PRIVATE TRANSCRIPT SENTINEL',
      'PRIVATE CONTEXT SENTINEL',
      'RAW PROVIDER BODY SENTINEL',
      'SECRET KEY SENTINEL',
    ]
    const summary = summarizeContentReliability([
      currentRow({
        prompt_text: privateValues[0],
        transcript: privateValues[1],
        custom_context: privateValues[2],
        provider_body: privateValues[3],
        secret: privateValues[4],
      }),
    ])
    const report = formatContentReliabilityReport(summary)
    for (const value of privateValues) expect(report).not.toContain(value)
    expect(report).toContain('aggregate status, version, call-count, and timestamp metadata only')
  })

  it('queries only scalar metadata inside a read-only transaction', async () => {
    const calls: Array<{ sql: string; parameters?: unknown[] }> = []
    const client = {
      async query(sql: string, parameters?: unknown[]) {
        calls.push({ sql, parameters })
        if (sql === CONTENT_RELIABILITY_QUERY) return { rows: [currentRow()] }
        return { rows: [] }
      },
    }

    const summary = await runReadOnlyContentReliabilityInspection(client, {
      limit: 100,
      since: null,
    })
    expect(summary.allSixContentMetricsScored).toBe(1)
    expect(calls.map(({ sql }) => sql)).toEqual([
      'begin read only',
      CONTENT_RELIABILITY_QUERY,
      'rollback',
    ])
    expect(calls[1]?.parameters).toEqual([100, null])
    expect(CONTENT_RELIABILITY_QUERY).not.toMatch(
      /prompt_text|transcript|custom_context|audio_path|user_id|\bid\b/i,
    )
    expect(CONTENT_RELIABILITY_QUERY).not.toMatch(/(?:^|\n)\s*metrics(?:\s|,|->)/im)
    expect(CONTENT_RELIABILITY_QUERY).not.toMatch(
      /\b(insert|update|delete|alter|drop|create|truncate)\b/i,
    )
  })

  it('rolls back and rethrows query failures', async () => {
    const statements: string[] = []
    const failure = Object.assign(new Error('private database detail'), { code: 'XX001' })
    const client = {
      async query(sql: string) {
        statements.push(sql)
        if (sql === CONTENT_RELIABILITY_QUERY) throw failure
        return { rows: [] }
      },
    }
    await expect(
      runReadOnlyContentReliabilityInspection(client, { limit: 100, since: null }),
    ).rejects.toBe(failure)
    expect(statements).toEqual(['begin read only', CONTENT_RELIABILITY_QUERY, 'rollback'])

    const source = readFileSync('scripts/inspect-content-reliability.mjs', 'utf8')
    expect(source).not.toContain('console.error(error.message)')
    expect(source).not.toContain('console.log(rows)')
  })

  it('does not echo a malformed database URL or its credentials', () => {
    const privateValue = 'PRIVATE_DATABASE_CREDENTIAL_SENTINEL'
    const result = spawnSync(process.execPath, ['scripts/inspect-content-reliability.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_DB_URL: `not-a-database-url-${privateValue}` },
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('database code: unknown')
    expect(result.stdout).not.toContain(privateValue)
    expect(result.stderr).not.toContain(privateValue)
  })
})
