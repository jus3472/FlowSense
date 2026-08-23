/**
 * Reports what was actually captured and stored for the most recent attempts.
 *
 * Written because the capture timelines cannot be checked from a headless
 * browser: audio never renders there, so amplitude and pitch come back empty and
 * the sampling rate reads as 1 Hz. This reads the real rows instead.
 *
 * Usage: npm run inspect:attempts [count]
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

const { SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env
if (!SUPABASE_DB_URL || !NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Needs SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SECRET_KEY.')
  process.exit(1)
}

const limit = Number(process.argv[2] ?? 2)
const EXPECTED_SAMPLES_PER_SECOND = 20

const client = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

const { rows } = await client.query(
  `select id, created_at, duration_ms, audio_path, transcript,
          metrics->'capture'->>'mime_type'          as mime_type,
          metrics->'capture'->'amplitude'           as amplitude,
          metrics->'capture'->'pitch'               as pitch,
          metrics->'transcript'->>'model'           as model,
          metrics->'transcript'->'words'            as words
     from attempts
    order by created_at desc
    limit $1`,
  [limit],
)
await client.end()

if (rows.length === 0) {
  console.log('No attempts found.')
  process.exit(0)
}

async function storageBytes(path) {
  if (!path) return null
  const res = await fetch(`${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/recordings/${path}`, {
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
  })
  if (!res.ok) return null
  return (await res.arrayBuffer()).byteLength
}

const pad = (label) => `${label}:`.padEnd(26)
const rate = (count, ms) => (ms > 0 ? (count / (ms / 1000)).toFixed(2) : 'n/a')
const verdict = (value) =>
  Math.abs(Number(value) - EXPECTED_SAMPLES_PER_SECOND) <= 2 ? 'near 20, as expected' : 'OFF TARGET'

for (const [index, attempt] of rows.entries()) {
  const amplitude = Array.isArray(attempt.amplitude) ? attempt.amplitude : []
  const pitch = Array.isArray(attempt.pitch) ? attempt.pitch : []
  const words = Array.isArray(attempt.words) ? attempt.words : []
  const bytes = await storageBytes(attempt.audio_path)

  const durationMs = attempt.duration_ms ?? 0
  const amplitudeRate = rate(amplitude.length, durationMs)
  // Pitch is voiced frames only, so its rate is a fraction of the sampling rate.
  const pitchRate = rate(pitch.length, durationMs)

  const transcript = attempt.transcript ?? ''
  const um = (transcript.match(/\bum\b/gi) ?? []).length
  const uh = (transcript.match(/\buh\b/gi) ?? []).length
  const umTokens = words.filter((w) => w.word?.toLowerCase() === 'um').length
  const uhTokens = words.filter((w) => w.word?.toLowerCase() === 'uh').length

  console.log(`\n${'='.repeat(74)}`)
  console.log(`Attempt ${index + 1} of ${rows.length}   ${attempt.id}`)
  console.log(`recorded ${new Date(attempt.created_at).toISOString()}`)
  console.log('='.repeat(74))
  console.log(pad('duration_ms'), durationMs, `(${(durationMs / 1000).toFixed(2)} s)`)
  console.log(pad('audio bytes in storage'), bytes === null ? 'MISSING' : bytes.toLocaleString())
  console.log(pad('mime type'), attempt.mime_type ?? 'unknown')
  console.log(
    pad('bytes per second'),
    bytes && durationMs ? Math.round(bytes / (durationMs / 1000)).toLocaleString() : 'n/a',
  )
  console.log(pad('amplitude samples'), amplitude.length)
  console.log(pad('amplitude samples/sec'), amplitudeRate, `<- ${verdict(amplitudeRate)}`)
  console.log(pad('pitch samples'), pitch.length)
  console.log(pad('pitch samples/sec'), pitchRate, '(voiced frames only, so below 20)')
  console.log(
    pad('voiced share of frames'),
    amplitude.length ? `${Math.round((pitch.length / amplitude.length) * 100)}%` : 'n/a',
  )
  console.log(pad('transcription model'), attempt.model ?? 'none')
  console.log(pad('word count'), words.length)
  console.log(
    pad('first word start'),
    words.length ? `${words[0].start}s ("${words[0].word}")` : 'no words',
  )
  console.log(pad('"um" tokens'), umTokens, `(${um} in transcript text)`)
  console.log(pad('"uh" tokens'), uhTokens, `(${uh} in transcript text)`)
  console.log(pad('filler tokens total'), umTokens + uhTokens)
}
console.log()
