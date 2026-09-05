/**
 * Prints the scored breakdown for recent attempts, so tuning the bands never
 * requires the UI.
 *
 * Usage: npm run inspect:scores [count]
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

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
    // No .env.local. Values may still come from the environment.
  }
}

loadEnvFile('.env.local')

if (!process.env.SUPABASE_DB_URL) {
  console.error('Needs SUPABASE_DB_URL in .env.local.')
  process.exit(1)
}

const limit = Number(process.argv[2] ?? 3)
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

const { rows } = await client.query(
  `select id, created_at, prompt_text, score, section_scores, practice_mode
     from attempts
    where score is not null
    order by created_at desc
    limit $1`,
  [limit],
)
await client.end()

if (rows.length === 0) {
  console.log('No scored attempts yet.')
  process.exit(0)
}

const pad = (label) => `${label}`.padEnd(22)
const line = (char = '=') => char.repeat(76)
const modes = new Set(['practice', 'interview', 'presentation', 'conversation'])
const contentMetrics = [
  'answered_prompt',
  'specificity',
  'structure',
  'conciseness',
  'word_choice',
  'grammar',
]
const audioMetrics = ['pace', 'paused_time', 'articulation', 'energy']

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value, keys) => {
  if (!isRecord(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => key in value)
}
const validMetricMap = (value, ids) =>
  exactKeys(value, ids) &&
  ids.every((id) => {
    const metric = value[id]
    if (
      !isRecord(metric) ||
      metric.metric !== id ||
      !['scored', 'not_checked', 'unavailable'].includes(metric.status) ||
      !Number.isInteger(metric.max_points) ||
      metric.max_points <= 0
    ) {
      return false
    }
    if (metric.status !== 'scored') {
      return metric.component === null && metric.earned_points === null
    }
    return (
      typeof metric.component === 'number' &&
      Number.isFinite(metric.component) &&
      metric.component >= 0 &&
      metric.component <= 1 &&
      Number.isInteger(metric.earned_points) &&
      metric.earned_points === Math.round(metric.component * metric.max_points)
    )
  })
const validSection = (value, id, metricIds) => {
  if (
    !isRecord(value) ||
    value.section !== id ||
    value.max_points !== 50 ||
    !validMetricMap(value.metrics, metricIds)
  ) {
    return false
  }
  const metrics = metricIds.map((metricId) => value.metrics[metricId])
  const maxTotal = metrics.reduce((sum, metric) => sum + metric.max_points, 0)
  const earned = metrics.map((metric) => metric.earned_points)
  const allScored = metrics.every((metric) => metric.status === 'scored')
  return (
    maxTotal === 50 &&
    (allScored
      ? value.status === 'scored' &&
        earned.every(Number.isInteger) &&
        value.earned_points === earned.reduce((sum, points) => sum + points, 0)
      : value.status !== 'scored' && value.earned_points === null)
  )
}
const validCurrentResult = (row, value) => {
  if (
    !isRecord(value) ||
    value.version !== 'v3.score.2' ||
    value.rubric_version !== 'v3' ||
    !modes.has(value.mode) ||
    row.practice_mode !== value.mode ||
    value.total_max_points !== 100 ||
    !isRecord(value.sections) ||
    !exactKeys(value.sections, ['what_you_said', 'how_you_sounded']) ||
    !validSection(value.sections.what_you_said, 'what_you_said', contentMetrics) ||
    !validSection(value.sections.how_you_sounded, 'how_you_sounded', audioMetrics)
  ) {
    return false
  }
  const sectionPoints = [
    value.sections.what_you_said.earned_points,
    value.sections.how_you_sounded.earned_points,
  ]
  const expectedTotal = sectionPoints.every(Number.isInteger)
    ? sectionPoints.reduce((sum, points) => sum + points, 0)
    : null
  return value.total_earned_points === expectedTotal && row.score === expectedTotal
}

for (const row of rows) {
  const sections = row.section_scores ?? {}

  console.log(`\n${line()}`)
  console.log(`${row.id}   ${new Date(row.created_at).toISOString()}`)
  console.log(`prompt: ${row.prompt_text}`)
  console.log(line())

  if (validCurrentResult(row, sections)) {
    console.log(`OVERALL ${row.score === null ? 'unavailable' : `${row.score} / 100`}`)
    if (sections.recommendation?.text) {
      console.log(`  recommendation: ${sections.recommendation.text}`)
    }
    for (const [sectionId, heading] of [
      ['what_you_said', 'WHAT YOU SAID'],
      ['how_you_sounded', 'HOW YOU SOUNDED'],
    ]) {
      const section = sections.sections?.[sectionId] ?? {}
      console.log(`\n${heading}`)
      console.log(
        `  ${section.earned_points === null ? '--' : section.earned_points} / ${section.max_points ?? 50}`,
      )
      for (const metric of Object.values(section.metrics ?? {})) {
        const points = metric.earned_points === null ? '--' : metric.earned_points
        const measurement = Object.entries(metric.measurements ?? {})
          .map(([name, value]) => `${name}=${value}`)
          .join(', ')
        console.log(
          `  ${pad(metric.metric)} ${String(points).padStart(2)} / ${metric.max_points}  ${metric.status}`,
        )
        if (measurement) console.log(`  ${' '.repeat(22)}     ${measurement}`)
        if (metric.explanation) console.log(`  ${' '.repeat(22)}     ${metric.explanation}`)
      }
    }
    if ((sections.warnings ?? []).length > 0) {
      console.log('\nWARNINGS')
      for (const warning of sections.warnings) console.log(`  ${warning}`)
    }
    continue
  }
  const scoreVersion = typeof sections.version === 'string' ? sections.version : 'unversioned'
  const rubricVersion =
    typeof sections.rubric_version === 'string' ? sections.rubric_version : 'unversioned'
  const label =
    scoreVersion === 'v3.score.2' && rubricVersion === 'v3'
      ? 'MALFORMED CURRENT RESULT'
      : 'UNSUPPORTED RESULT'
  console.log(`${label} ${scoreVersion} / ${rubricVersion}`)
}
console.log()
