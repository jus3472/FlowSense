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
  `select id, created_at, prompt_text, transcript, score, section_scores,
          metrics->'delivery' as delivery, content_result
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

const bar = (earned, max, width = 20) => {
  const filled = max > 0 ? Math.round((earned / max) * width) : 0
  return '#'.repeat(filled) + '.'.repeat(width - filled)
}
const pad = (label) => `${label}`.padEnd(22)
const line = (char = '=') => char.repeat(76)

for (const row of rows) {
  const sections = row.section_scores ?? {}
  const delivery = row.delivery ?? {}
  const metrics = delivery.metrics ?? {}
  const stats = delivery.statistics ?? {}
  const content = row.content_result ?? {}

  console.log(`\n${line()}`)
  console.log(`${row.id}   ${new Date(row.created_at).toISOString()}`)
  console.log(`prompt: ${row.prompt_text}`)
  console.log(line())
  console.log(`CLARITY ${row.score} / 100`)
  console.log(
    `  content  ${String(sections.content?.earned ?? 0).padStart(2)} / ${sections.content?.max ?? 50}  ${bar(sections.content?.earned ?? 0, sections.content?.max ?? 50)}`,
  )
  console.log(
    `  delivery ${String(sections.delivery?.earned ?? 0).padStart(2)} / ${sections.delivery?.max ?? 50}  ${bar(sections.delivery?.earned ?? 0, sections.delivery?.max ?? 50)}`,
  )

  console.log('\nWHAT YOU SAID')
  if (content.status !== 'checked') {
    console.log(`  not checked: ${content.error ?? 'no reason recorded'} (full points awarded)`)
  }
  for (const [name, points] of Object.entries(content.points ?? {})) {
    const check = content.checks?.[name] ?? {}
    const verdict = check.passed ? 'pass' : (check.severity ?? 'fail')
    console.log(`  ${pad(name)} ${String(points).padStart(2)}  ${verdict}`)
    if (check.quote) console.log(`  ${' '.repeat(22)}     quote: "${check.quote}"`)
    if (check.observation) console.log(`  ${' '.repeat(22)}     ${check.observation}`)
    if (check.suggestion) console.log(`  ${' '.repeat(22)}     try: ${check.suggestion}`)
  }
  const spans = content.extra_spans ?? []
  console.log(`  ${pad('flagged spans')} ${spans.length}`)
  for (const span of spans) console.log(`  ${' '.repeat(22)}     [${span.category}] "${span.text}"`)

  console.log('\nHOW YOU SOUNDED')
  for (const [name, metric] of Object.entries(metrics)) {
    const raw = typeof metric.raw === 'number' ? metric.raw.toFixed(2) : metric.raw
    console.log(
      `  ${pad(name)} ${String(metric.points).padStart(2)} / ${metric.max_points}  raw=${String(raw).padStart(7)}  component=${metric.component.toFixed(2)}  ${metric.label ?? ''}`,
    )
  }

  console.log('\nSTATISTICS, never scored')
  console.log(`  ${pad('words')} ${stats.word_count}`)
  console.log(`  ${pad('recording')} ${((stats.recording_ms ?? 0) / 1000).toFixed(1)}s`)
  console.log(`  ${pad('speaking time')} ${((stats.speaking_ms ?? 0) / 1000).toFixed(1)}s`)
  console.log(
    `  ${pad('silence')} ${((stats.total_silence_ms ?? 0) / 1000).toFixed(1)}s (${Math.round((stats.silence_ratio ?? 0) * 100)}%), leading ${((stats.leading_silence_ms ?? 0) / 1000).toFixed(1)}s`,
  )
  console.log(
    `  ${pad('pauses')} ${stats.mid_sentence_pause_count} mid-sentence, ${stats.clean_pause_count} clean, longest ${((stats.longest_pause_ms ?? 0) / 1000).toFixed(1)}s`,
  )
  console.log(`  ${pad('pace variance')} ${(stats.pace_variance ?? 0).toFixed(1)} wpm`)
  console.log(
    `  ${pad('backtracks')} ${stats.backtrack_count}${stats.backtrack_note ? ` (${stats.backtrack_note})` : ''}`,
  )

  // Tokens, not entries: "you know" is one entry and two tokens, and the token
  // count is the one Filler words charged for.
  const items = stats.counted_items ?? []
  const countedTokens = items.reduce((sum, item) => sum + (item.token_indices?.length ?? 0), 0)
  console.log(`  ${pad('counted tokens')} ${countedTokens} in ${items.length} entries`)
  for (const item of items) {
    const tokens = item.token_indices?.length ?? 0
    console.log(
      `  ${' '.repeat(22)}     [${item.category}/${item.subtype}] "${item.text}" x${tokens} @${item.start?.toFixed?.(2) ?? '?'}s`,
    )
  }
  const phrases = stats.repeated_phrases ?? []
  console.log(
    `  ${pad('repeated phrases')} ${phrases.map((p) => `"${p.phrase}" x${p.count}`).join(', ') || 'none'}`,
  )

  if (content.tightened) {
    // clean, retried, or stripped: what it took to get the counted padding out.
    console.log(`\nTIGHTENED (${content.tightened_outcome ?? 'not recorded'})`)
    console.log(`  ${content.tightened}`)
  }
  if ((content.dropped ?? []).length > 0) {
    console.log('\nDROPPED IN VALIDATION')
    for (const note of content.dropped) console.log(`  ${note}`)
  }
  if ((delivery.warnings ?? []).length > 0) {
    console.log('\nWARNINGS')
    for (const warning of delivery.warnings) console.log(`  ${warning}`)
  }
}
console.log()
