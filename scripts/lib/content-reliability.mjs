export const CURRENT_SCORE_PAYLOAD_VERSION = 'v2.score.1'
export const CURRENT_RUBRIC_VERSION = 'v2'
export const CURRENT_CONTENT_PAYLOAD_VERSION = 'v2.content-detector.1'

export const DEFAULT_CONTENT_RELIABILITY_LIMIT = 100
export const MAX_CONTENT_RELIABILITY_LIMIT = 1_000

export const SCORE_CATEGORIES = [
  'fluency',
  'clarity',
  'vocabulary',
  'grammar',
  'structure',
  'delivery',
]

export const CONTENT_CATEGORIES = ['structure', 'grammar', 'vocabulary']

/**
 * These codes are bounded in the provider adapter but are currently logged,
 * not persisted. The report names that limitation instead of presenting zero
 * as evidence that a failure class did not occur.
 */
export const UNPERSISTED_PROVIDER_DIAGNOSTIC_CODES = [
  'schema_invalid',
  'malformed_json',
  'empty_response',
  'truncated_response',
  'timeout',
  'rate_limit',
  'server_error',
  'network_failure',
  'authentication_error',
  'configuration_error',
  'unknown_provider_failure',
]

/**
 * Project only bounded scalar metadata. Stored score/content JSON also holds
 * transcript evidence, so this query must never select either JSON document
 * wholesale.
 */
export const CONTENT_RELIABILITY_QUERY = `
select
  coalesce(finished_at, created_at) as completed_at,
  section_scores ->> 'version' as score_payload_version,
  section_scores ->> 'rubric_version' as score_rubric_version,
  content_result ->> 'version' as content_payload_version,
  content_result ->> 'status' as content_status,
  content_result ->> 'calls' as content_calls,
  section_scores #>> '{categories,fluency,status}' as score_fluency_status,
  section_scores #>> '{categories,clarity,status}' as score_clarity_status,
  section_scores #>> '{categories,vocabulary,status}' as score_vocabulary_status,
  section_scores #>> '{categories,grammar,status}' as score_grammar_status,
  section_scores #>> '{categories,structure,status}' as score_structure_status,
  section_scores #>> '{categories,delivery,status}' as score_delivery_status,
  content_result #>> '{categories,structure,status}' as content_structure_status,
  content_result #>> '{categories,grammar,status}' as content_grammar_status,
  content_result #>> '{categories,vocabulary,status}' as content_vocabulary_status,
  coalesce(
    jsonb_typeof(section_scores) = 'object'
      and section_scores ? 'content'
      and section_scores ? 'delivery',
    false
  ) as has_legacy_score_shape,
  coalesce(
    jsonb_typeof(content_result) = 'object'
      and content_result ? 'checks'
      and content_result ? 'points',
    false
  ) as has_legacy_content_shape
from public.attempts
where status = 'done'
  and (
    $2::timestamptz is null
    or coalesce(finished_at, created_at) >= $2::timestamptz
  )
order by finished_at desc nulls last, created_at desc
limit $1
`

function parseLimit(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error('The inspection limit must be a whole number.')
  }
  const parsed = Number(value)
  if (parsed < 1 || parsed > MAX_CONTENT_RELIABILITY_LIMIT) {
    throw new Error(`The inspection limit must be between 1 and ${MAX_CONTENT_RELIABILITY_LIMIT}.`)
  }
  return parsed
}

function parseSince(value) {
  const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
  if (!isoTimestamp.test(value)) {
    throw new Error('The inspection start time must be a valid ISO-8601 timestamp.')
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('The inspection start time must be a valid ISO-8601 timestamp.')
  }
  return parsed.toISOString()
}

export function parseContentReliabilityOptions(args) {
  let limit = DEFAULT_CONTENT_RELIABILITY_LIMIT
  let since = null
  let positionalLimitSeen = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help') return { help: true, limit, since }

    if (argument === '--limit') {
      const value = args[index + 1]
      if (value === undefined) throw new Error('--limit needs a value.')
      limit = parseLimit(value)
      index += 1
      continue
    }
    if (argument.startsWith('--limit=')) {
      limit = parseLimit(argument.slice('--limit='.length))
      continue
    }
    if (argument === '--since') {
      const value = args[index + 1]
      if (value === undefined) throw new Error('--since needs a value.')
      since = parseSince(value)
      index += 1
      continue
    }
    if (argument.startsWith('--since=')) {
      since = parseSince(argument.slice('--since='.length))
      continue
    }
    if (!argument.startsWith('-') && !positionalLimitSeen) {
      limit = parseLimit(argument)
      positionalLimitSeen = true
      continue
    }
    throw new Error('An inspection option was not recognized.')
  }

  return { help: false, limit, since }
}

function strictInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return null
}

function safeTimestamp(value) {
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null
}

function isCurrentV2(row) {
  return (
    row.score_payload_version === CURRENT_SCORE_PAYLOAD_VERSION &&
    row.score_rubric_version === CURRENT_RUBRIC_VERSION
  )
}

function isLegacy(row) {
  return (
    row.score_payload_version == null &&
    row.content_payload_version == null &&
    (row.has_legacy_score_shape === true || row.has_legacy_content_shape === true)
  )
}

function scoreStatus(row, category) {
  return row[`score_${category}_status`]
}

function contentStatus(row, category) {
  return row[`content_${category}_status`]
}

export function summarizeContentReliability(rows, options = {}) {
  const limit = options.limit ?? DEFAULT_CONTENT_RELIABILITY_LIMIT
  const since = options.since ?? null
  const summary = {
    window: {
      limit,
      since,
      oldestCompletedAt: null,
      newestCompletedAt: null,
    },
    completedAttempts: rows.length,
    v2Attempts: 0,
    legacyAttempts: 0,
    unsupportedOrMalformedAttempts: 0,
    allSixCategoriesChecked: 0,
    v2WithoutAllSixCategories: 0,
    contentFullyChecked: 0,
    contentPartiallyNotChecked: 0,
    contentAllNotChecked: 0,
    malformedOrInconsistentV2Snapshots: 0,
    callsOne: 0,
    callsTwo: 0,
    callsOtherOrMissing: 0,
    successfulRetryRecoveries: 0,
    inferredDiagnostics: { missing_section: 0 },
    missingSections: { structure: 0, grammar: 0, vocabulary: 0 },
    attemptsNeedingUnpersistedDiagnosticDetail: 0,
  }

  const completedTimes = []

  for (const row of rows) {
    const completedAt = safeTimestamp(row.completed_at)
    if (completedAt !== null) completedTimes.push(completedAt)

    if (isLegacy(row)) {
      summary.legacyAttempts += 1
      continue
    }
    if (!isCurrentV2(row)) {
      summary.unsupportedOrMalformedAttempts += 1
      continue
    }

    summary.v2Attempts += 1
    const calls = strictInteger(row.content_calls)
    if (calls === 1) summary.callsOne += 1
    else if (calls === 2) summary.callsTwo += 1
    else summary.callsOtherOrMissing += 1

    const scoreStatuses = SCORE_CATEGORIES.map((category) => scoreStatus(row, category))
    const validScoreStatuses = scoreStatuses.every(
      (status) => status === 'scored' || status === 'not_checked' || status === 'unavailable',
    )
    const contentStatuses = CONTENT_CATEGORIES.map((category) => contentStatus(row, category))
    const validContentStatuses = contentStatuses.every(
      (status) => status === 'checked' || status === 'not_checked',
    )
    const checkedContentCount = contentStatuses.filter((status) => status === 'checked').length
    const expectedTopLevelContentStatus = checkedContentCount > 0 ? 'checked' : 'not_checked'
    const contentMatchesScore = CONTENT_CATEGORIES.every((category) => {
      const expectedScoreStatus =
        contentStatus(row, category) === 'checked' ? 'scored' : 'not_checked'
      return scoreStatus(row, category) === expectedScoreStatus
    })
    const validContent =
      row.content_payload_version === CURRENT_CONTENT_PAYLOAD_VERSION &&
      validContentStatuses &&
      row.content_status === expectedTopLevelContentStatus &&
      calls !== null &&
      calls >= 0 &&
      calls <= 2 &&
      validScoreStatuses &&
      contentMatchesScore

    if (!validContent) {
      summary.v2WithoutAllSixCategories += 1
      summary.malformedOrInconsistentV2Snapshots += 1
      summary.attemptsNeedingUnpersistedDiagnosticDetail += 1
      continue
    }

    const allSix = scoreStatuses.every((status) => status === 'scored')
    if (allSix) summary.allSixCategoriesChecked += 1
    else summary.v2WithoutAllSixCategories += 1

    const notChecked = CONTENT_CATEGORIES.filter(
      (category) => contentStatus(row, category) === 'not_checked',
    )
    if (notChecked.length === 0) {
      summary.contentFullyChecked += 1
      if (calls === 2) {
        summary.successfulRetryRecoveries += 1
        summary.attemptsNeedingUnpersistedDiagnosticDetail += 1
      }
      continue
    }

    if (notChecked.length === CONTENT_CATEGORIES.length) {
      summary.contentAllNotChecked += 1
      summary.attemptsNeedingUnpersistedDiagnosticDetail += 1
      continue
    }

    summary.contentPartiallyNotChecked += 1
    summary.inferredDiagnostics.missing_section += 1
    summary.attemptsNeedingUnpersistedDiagnosticDetail += 1
    for (const category of notChecked) summary.missingSections[category] += 1
  }

  if (completedTimes.length > 0) {
    summary.window.oldestCompletedAt = new Date(Math.min(...completedTimes)).toISOString()
    summary.window.newestCompletedAt = new Date(Math.max(...completedTimes)).toISOString()
  }

  return summary
}

const pad = (label) => `${label}:`.padEnd(42)

export function formatContentReliabilityReport(summary) {
  const lines = [
    'Content provider reliability',
    '',
    `${pad('Completed attempts inspected')} ${summary.completedAttempts}`,
    `${pad('Configured row limit')} ${summary.window.limit}`,
    `${pad('Since')} ${summary.window.since ?? 'not set'}`,
    `${pad('Oldest completion in result')} ${summary.window.oldestCompletedAt ?? 'none'}`,
    `${pad('Newest completion in result')} ${summary.window.newestCompletedAt ?? 'none'}`,
    '',
    'Stored result cohorts',
    `${pad('Current v2 attempts')} ${summary.v2Attempts}`,
    `${pad('Legacy attempts')} ${summary.legacyAttempts}`,
    `${pad('Unsupported or malformed attempts')} ${summary.unsupportedOrMalformedAttempts}`,
    '',
    'Result completeness',
    `${pad('All six categories checked')} ${summary.allSixCategoriesChecked}`,
    `${pad('V2 without all six checked')} ${summary.v2WithoutAllSixCategories}`,
    `${pad('All content categories checked')} ${summary.contentFullyChecked}`,
    `${pad('Partially not checked')} ${summary.contentPartiallyNotChecked}`,
    `${pad('All content categories not checked')} ${summary.contentAllNotChecked}`,
    `${pad('Malformed or inconsistent v2 snapshots')} ${summary.malformedOrInconsistentV2Snapshots}`,
    '',
    'Provider calls',
    `${pad('content_result.calls = 1')} ${summary.callsOne}`,
    `${pad('content_result.calls = 2')} ${summary.callsTwo}`,
    `${pad('Other or missing call count')} ${summary.callsOtherOrMissing}`,
    `${pad('Successful retry recoveries')} ${summary.successfulRetryRecoveries}`,
    '',
    'Bounded diagnostic outcomes',
    `${pad('missing_section (inferred)')} ${summary.inferredDiagnostics.missing_section}`,
    `${pad('Missing structure')} ${summary.missingSections.structure}`,
    `${pad('Missing grammar')} ${summary.missingSections.grammar}`,
    `${pad('Missing vocabulary')} ${summary.missingSections.vocabulary}`,
    `${pad('Rows needing exact provider detail')} ${summary.attemptsNeedingUnpersistedDiagnosticDetail}`,
    '',
    'Detailed provider codes are not currently persisted in stored attempts.',
    'The following bounded runtime codes therefore cannot be reconstructed from stored rows:',
    `  ${UNPERSISTED_PROVIDER_DIAGNOSTIC_CODES.join(', ')}`,
    '',
    'This report contains aggregate status, version, call-count, and timestamp metadata only.',
  ]
  return lines.join('\n')
}

export async function runReadOnlyContentReliabilityInspection(client, options) {
  await client.query('begin read only')
  try {
    const result = await client.query(CONTENT_RELIABILITY_QUERY, [options.limit, options.since])
    await client.query('rollback')
    return summarizeContentReliability(result.rows, options)
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // Preserve the original query failure.
    }
    throw error
  }
}
