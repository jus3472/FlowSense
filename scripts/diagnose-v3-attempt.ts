import { readFileSync } from 'node:fs'
import pg from 'pg'
import { createDeepSeekModel } from '@/lib/deepseek/provider'
import { PRACTICE_MODES, type PracticeMode } from '@/lib/practice/contracts'
import { assembleV3Score } from '@/lib/scoring/v3/assemble'
import { evaluateAudioMetrics } from '@/lib/scoring/v3/audio'
import { v3AudioMetrics } from '@/lib/scoring/v3/audio-result'
import { v3ContentEvaluatorFromModel } from '@/lib/scoring/v3/content/adapter'
import { runV3ContentEvaluation } from '@/lib/scoring/v3/content/evaluate'
import { v3ContentEvidenceInput } from '@/lib/scoring/v3/content/input'
import type { AttemptMetrics } from '@/lib/types/metrics'

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    const name = match?.[1]
    const raw = match?.[2]
    if (!name || raw === undefined || process.env[name]) continue
    process.env[name] = raw.replace(/^["']|["']$/g, '')
  }
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required in the local environment.`)
  return value
}

function practiceMode(value: unknown): PracticeMode {
  if (typeof value === 'string' && (PRACTICE_MODES as readonly string[]).includes(value)) {
    return value as PracticeMode
  }
  throw new Error('The attempt does not have a supported practice mode.')
}

loadEnvFile('.env.local')
const attemptId = process.argv[2]
if (!attemptId) throw new Error('Usage: npm run diagnose:v3-attempt -- <attempt-id>')

const client = new pg.Client({
  connectionString: required('SUPABASE_DB_URL', process.env.SUPABASE_DB_URL),
  ssl: { rejectUnauthorized: false },
})
await client.connect()
const result = await client.query(
  `select prompt_text, transcript, practice_mode, metrics
     from public.attempts
    where id = $1
    limit 1`,
  [attemptId],
)
await client.end()
const row = result.rows[0]
if (!row) throw new Error('The attempt was not found.')

const transcript = typeof row.transcript === 'string' ? row.transcript : ''
const mode = practiceMode(row.practice_mode)
const metrics = (row.metrics ?? {}) as AttemptMetrics
const words = metrics.transcript?.words ?? []
const evidence = v3ContentEvidenceInput(transcript, words)
const audio = evaluateAudioMetrics({ capture: metrics.capture, words, transcript, mode })
const content = await runV3ContentEvaluation({
  provider: v3ContentEvaluatorFromModel(
    createDeepSeekModel(required('DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY)),
  ),
  mode,
  prompt: typeof row.prompt_text === 'string' ? row.prompt_text : '',
  transcript,
  ...evidence,
  timeoutMs: 30_000,
  diagnosticAttemptId: attemptId,
})
const assembled = assembleV3Score({ mode, content, sounded: v3AudioMetrics(audio) })

console.log('V3 attempt diagnostic')
console.log(`Attempt: ${attemptId}`)
console.log(`Content status: ${content.status}`)
console.log(`Provider calls: ${content.calls}`)
console.log(`Content diagnostic: ${JSON.stringify(content.diagnostic ?? null)}`)
console.log(
  `Scored content metrics: ${Object.values(content.metrics).filter((metric) => metric.status === 'scored').length} / 6`,
)
console.log(
  `Content components: ${JSON.stringify(Object.fromEntries(Object.entries(content.metrics).map(([id, metric]) => [id, metric.component])))}`,
)
console.log(`Overall score: ${assembled.total_earned_points ?? 'unavailable'} / 100`)
console.log(`Pace: ${JSON.stringify(audio.metrics.pace.measurements)}`)
console.log(`Paused time: ${JSON.stringify(audio.metrics.paused_time.measurements)}`)
console.log(`Articulation: ${JSON.stringify(audio.metrics.articulation.measurements)}`)
console.log(`Energy: ${JSON.stringify(audio.metrics.energy.measurements)}`)
if (content.status !== 'checked') process.exitCode = 2
