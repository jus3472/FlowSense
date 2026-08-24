/**
 * Replays the rewrite enforcement over every stored attempt and reports how many
 * rewrites came back clean, how many needed the model asked again, and how many
 * had to be cut by hand.
 *
 * The app's own modules are imported rather than reimplemented, so this measures
 * the shipped rule and not a copy of it.
 *
 * Usage: npm run inspect:rewrites [-- --write]
 *   --write stores the enforced rewrite and its outcome back on the attempt.
 *
 * Node strips the types itself. The transform flag in the npm script is for the
 * constructor parameter properties in the network helper, which strip-only mode
 * cannot erase on its own.
 */
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import pg from 'pg'

register('./alias-hooks.mjs', import.meta.url)

const { createDeepSeekModel } = await import('../src/lib/deepseek/provider.ts')
const { REWRITE_SYSTEM_PROMPT, buildRewriteRetryPrompt } =
  await import('../src/lib/deepseek/prompt.ts')
const { enforceTightened } = await import('../src/lib/scoring/run-content.ts')
const { findTightenViolations } = await import('../src/lib/scoring/tighten.ts')

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

const write = process.argv.includes('--write')
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  console.error('Needs DEEPSEEK_API_KEY in .env.local: the retry is a real model call.')
  process.exit(1)
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

const { rows } = await client.query(
  `select id, created_at, transcript, content_result,
          metrics->'delivery'->'statistics' as statistics
     from attempts
    where content_result is not null
    order by created_at asc`,
)

const model = createDeepSeekModel(apiKey)
const line = (char = '=') => char.repeat(76)
const tally = { none: 0, clean: 0, retried: 0, stripped: 0 }
const stillDirty = []

for (const row of rows) {
  const content = row.content_result ?? {}
  const statistics = row.statistics ?? {}
  const countedItems = statistics.counted_items ?? []
  const countedTokens = countedItems.reduce(
    (sum, item) => sum + (item.token_indices?.length ?? 0),
    0,
  )

  const parsed = {
    checks: content.checks ?? {},
    extra_spans: content.extra_spans ?? [],
    tightened: content.tightened ?? null,
    dropped: content.dropped ?? [],
    tightened_outcome: 'none',
  }

  const before = parsed.tightened
  const spans = parsed.extra_spans.map((span) => span.text)
  if (parsed.checks.word_choice && parsed.checks.word_choice.passed === false) {
    if (parsed.checks.word_choice.quote) spans.push(parsed.checks.word_choice.quote)
  }
  const violations = before ? findTightenViolations(before, spans) : []

  const enforced = await enforceTightened(parsed, {
    model,
    transcript: row.transcript ?? '',
    countedTokens,
    rewriteRequest: ({ previous, mustNotAppear, targetWords }) => ({
      system: REWRITE_SYSTEM_PROMPT,
      user: buildRewriteRetryPrompt({
        transcript: row.transcript ?? '',
        previous,
        mustNotAppear,
        targetWords,
      }),
      timeoutMs: 30_000,
    }),
  })

  const outcome = enforced.report.outcome
  tally[outcome] += 1

  console.log(`\n${line()}`)
  console.log(`${row.id}   ${new Date(row.created_at).toISOString()}   ${outcome}`)
  console.log(line())
  if (outcome === 'none') {
    console.log('  no rewrite was stored')
  } else {
    console.log(`  before: ${before}`)
    if (violations.length > 0) {
      console.log(`  left in: ${violations.map((v) => `[${v.source}] "${v.text}"`).join(', ')}`)
    }
    if (outcome !== 'clean') {
      console.log(`  after : ${enforced.parsed.tightened}`)
    }
    if (enforced.report.removed.length > 0) {
      console.log(`  cut by hand: ${enforced.report.removed.map((t) => `"${t}"`).join(', ')}`)
    }
    if (enforced.report.remaining.length > 0) {
      console.log(`  still there: ${enforced.report.remaining.map((t) => `"${t}"`).join(', ')}`)
      stillDirty.push(row.id)
    }
  }

  if (write && outcome !== 'none' && enforced.parsed.tightened !== before) {
    await client.query(
      `update attempts
          set content_result = jsonb_set(
                jsonb_set(content_result, '{tightened}', $2::jsonb, true),
                '{tightened_outcome}', $3::jsonb, true)
        where id = $1`,
      [row.id, JSON.stringify(enforced.parsed.tightened), JSON.stringify(outcome)],
    )
  } else if (write && outcome === 'clean') {
    await client.query(
      `update attempts
          set content_result = jsonb_set(content_result, '{tightened_outcome}', $2::jsonb, true)
        where id = $1`,
      [row.id, JSON.stringify(outcome)],
    )
  }
}

await client.end()

const enforcedCount = tally.clean + tally.retried + tally.stripped
console.log(`\n${line()}`)
console.log(`REWRITES ACROSS ${rows.length} ATTEMPTS`)
console.log(line())
console.log(`  passed cleanly       ${tally.clean} / ${enforcedCount}`)
console.log(`  needed a retry       ${tally.retried} / ${enforcedCount}`)
console.log(`  needed the strip     ${tally.stripped} / ${enforcedCount}`)
console.log(`  no rewrite stored    ${tally.none}`)
if (stillDirty.length > 0) {
  console.log(`  counted text still present in ${stillDirty.length}: ${stillDirty.join(', ')}`)
}
console.log(write ? '\nWritten back to the attempts.' : '\nRead only. Pass --write to store these.')
