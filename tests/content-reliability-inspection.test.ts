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

const scoreStatuses = (status = 'scored') => ({
  score_fluency_status: status,
  score_clarity_status: status,
  score_vocabulary_status: status,
  score_grammar_status: status,
  score_structure_status: status,
  score_delivery_status: status,
})

const contentStatuses = (overrides: Record<string, string> = {}) => ({
  content_structure_status: 'checked',
  content_grammar_status: 'checked',
  content_vocabulary_status: 'checked',
  ...overrides,
})

function v2Row(overrides: Record<string, unknown> = {}) {
  return {
    completed_at: '2026-08-28T03:00:00.000Z',
    score_payload_version: 'v2.score.1',
    score_rubric_version: 'v2',
    content_payload_version: 'v2.content-detector.1',
    content_status: 'checked',
    content_calls: '1',
    has_legacy_score_shape: false,
    has_legacy_content_shape: false,
    ...scoreStatuses(),
    ...contentStatuses(),
    ...overrides,
  }
}

describe('content reliability inspection', () => {
  it('parses a bounded default, positional limit, and completion window', () => {
    expect(parseContentReliabilityOptions([])).toEqual({
      help: false,
      limit: 100,
      since: null,
    })
    expect(parseContentReliabilityOptions(['25'])).toMatchObject({ limit: 25 })
    expect(
      parseContentReliabilityOptions(['--limit', '250', '--since', '2026-08-28T02:16:28Z']),
    ).toEqual({
      help: false,
      limit: 250,
      since: '2026-08-28T02:16:28.000Z',
    })
    expect(() => parseContentReliabilityOptions(['0'])).toThrow('between 1 and 1000')
    expect(() => parseContentReliabilityOptions(['1001'])).toThrow('between 1 and 1000')
    expect(() => parseContentReliabilityOptions(['--since', '1'])).toThrow('valid ISO-8601')
    expect(() => parseContentReliabilityOptions(['--since', 'private transcript'])).toThrow(
      'valid ISO-8601',
    )
    expect(() => parseContentReliabilityOptions(['--private-secret'])).toThrow(
      'option was not recognized',
    )
  })

  it('counts complete, partial, unavailable, and recovered v2 content safely', () => {
    const summary = summarizeContentReliability([
      v2Row(),
      v2Row({ content_calls: '2', completed_at: '2026-08-28T03:01:00.000Z' }),
      v2Row({
        content_calls: '2',
        content_grammar_status: 'not_checked',
        content_vocabulary_status: 'not_checked',
        score_grammar_status: 'not_checked',
        score_vocabulary_status: 'not_checked',
      }),
      v2Row({
        content_status: 'not_checked',
        content_structure_status: 'not_checked',
        content_grammar_status: 'not_checked',
        content_vocabulary_status: 'not_checked',
        score_structure_status: 'not_checked',
        score_grammar_status: 'not_checked',
        score_vocabulary_status: 'not_checked',
      }),
    ])

    expect(summary).toMatchObject({
      completedAttempts: 4,
      v2Attempts: 4,
      allSixCategoriesChecked: 2,
      v2WithoutAllSixCategories: 2,
      contentFullyChecked: 2,
      contentPartiallyNotChecked: 1,
      contentAllNotChecked: 1,
      callsOne: 2,
      callsTwo: 2,
      callsOtherOrMissing: 0,
      successfulRetryRecoveries: 1,
      inferredDiagnostics: { missing_section: 1 },
      missingSections: { structure: 0, grammar: 1, vocabulary: 1 },
      attemptsNeedingUnpersistedDiagnosticDetail: 3,
    })
  })

  it('separates legacy, unsupported, and malformed rows without treating them as failures', () => {
    const summary = summarizeContentReliability([
      {
        completed_at: '2026-08-27T00:00:00Z',
        score_payload_version: null,
        content_payload_version: null,
        has_legacy_score_shape: true,
        has_legacy_content_shape: true,
      },
      {
        completed_at: '2026-08-27T01:00:00Z',
        score_payload_version: 'v3.score.1',
        score_rubric_version: 'v3',
        content_payload_version: 'v3.content.1',
      },
      {
        completed_at: 'invalid',
        score_payload_version: null,
        content_payload_version: null,
        has_legacy_score_shape: false,
        has_legacy_content_shape: false,
      },
      v2Row({ content_payload_version: null, content_calls: 'private value' }),
    ])

    expect(summary).toMatchObject({
      completedAttempts: 4,
      v2Attempts: 1,
      legacyAttempts: 1,
      unsupportedOrMalformedAttempts: 2,
      malformedOrInconsistentV2Snapshots: 1,
      callsOtherOrMissing: 1,
    })
  })

  it('does not count malformed or inconsistent current v2 snapshots as healthy', () => {
    const summary = summarizeContentReliability([
      v2Row({ content_calls: 'invalid' }),
      v2Row({ content_status: 'not_checked' }),
      v2Row({ content_grammar_status: 'not_checked' }),
    ])

    expect(summary).toMatchObject({
      completedAttempts: 3,
      v2Attempts: 3,
      allSixCategoriesChecked: 0,
      v2WithoutAllSixCategories: 3,
      contentFullyChecked: 0,
      contentPartiallyNotChecked: 0,
      contentAllNotChecked: 0,
      malformedOrInconsistentV2Snapshots: 3,
      callsOne: 2,
      callsOtherOrMissing: 1,
      successfulRetryRecoveries: 0,
      attemptsNeedingUnpersistedDiagnosticDetail: 3,
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
      v2Row({
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
        if (sql === CONTENT_RELIABILITY_QUERY) return { rows: [v2Row()] }
        return { rows: [] }
      },
    }

    const summary = await runReadOnlyContentReliabilityInspection(client, {
      limit: 100,
      since: null,
    })

    expect(summary.allSixCategoriesChecked).toBe(1)
    expect(calls.map(({ sql }) => sql)).toEqual([
      'begin read only',
      CONTENT_RELIABILITY_QUERY,
      'rollback',
    ])
    expect(calls[1]?.parameters).toEqual([100, null])
    expect(CONTENT_RELIABILITY_QUERY).not.toMatch(
      /prompt_text|transcript|custom_context|audio_path|metrics|user_id|\bid\b/i,
    )
    expect(CONTENT_RELIABILITY_QUERY).not.toMatch(
      /\b(insert|update|delete|alter|drop|create|truncate)\b/i,
    )
  })

  it('rolls back and rethrows query failures without using data health as an exit condition', async () => {
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
      env: {
        ...process.env,
        SUPABASE_DB_URL: `not-a-database-url-${privateValue}`,
      },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('database code: unknown')
    expect(result.stdout).not.toContain(privateValue)
    expect(result.stderr).not.toContain(privateValue)
  })
})
