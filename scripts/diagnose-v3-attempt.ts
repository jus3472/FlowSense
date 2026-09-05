import { readFileSync } from 'node:fs'
import pg from 'pg'
import { createDeepSeekModel } from '@/lib/deepseek/provider'
import { PRACTICE_MODES, type PracticeMode } from '@/lib/practice/contracts'
import { assembleV3Score } from '@/lib/scoring/v3/assemble'
import { evaluateAudioMetrics } from '@/lib/scoring/v3/audio'
import { v3AudioMetrics } from '@/lib/scoring/v3/audio-result'
import { v3ContentEvaluatorFromModel } from '@/lib/scoring/v3/content/adapter'
import {
  parseV3ContentResponse,
  runV3ContentEvaluation,
  V3ContentParseError,
} from '@/lib/scoring/v3/content/evaluate'
import { v3ContentEvidenceInput } from '@/lib/scoring/v3/content/input'
import type {
  V3ContentEvaluatorProvider,
  V3ContentEvaluatorRequest,
} from '@/lib/scoring/v3/content/contracts'
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

interface ProviderResponseTrace {
  call: number
  validation: 'passed' | 'failed'
  code: string | null
  reason: string | null
  metric: string | null
  concisenessFindings: unknown
}

function concisenessFindingShape(raw: string): unknown {
  try {
    const payload = JSON.parse(raw) as {
      metrics?: { conciseness?: { findings?: unknown } }
    }
    const findings = payload.metrics?.conciseness?.findings
    if (!Array.isArray(findings)) return null
    return findings.map((finding) => {
      if (typeof finding !== 'object' || finding === null || Array.isArray(finding)) return null
      const record = finding as Record<string, unknown>
      const supportingSpans = Array.isArray(record.supporting_spans)
        ? record.supporting_spans.slice(0, 4).map((span) => {
            if (typeof span !== 'object' || span === null || Array.isArray(span)) return null
            const evidence = span as Record<string, unknown>
            return {
              quote:
                typeof evidence.quote === 'string' ? evidence.quote.slice(0, 160) : evidence.quote,
              start: evidence.start ?? null,
              end: evidence.end ?? null,
              occurrence: evidence.occurrence ?? null,
            }
          })
        : null
      return {
        keys: Object.keys(record),
        kind: record.kind ?? null,
        quote: typeof record.quote === 'string' ? record.quote.slice(0, 160) : record.quote,
        start: record.start ?? null,
        end: record.end ?? null,
        occurrence: record.occurrence ?? null,
        supporting_spans: supportingSpans,
      }
    })
  } catch {
    return null
  }
}

function tracedProvider(
  provider: V3ContentEvaluatorProvider,
  traces: ProviderResponseTrace[],
): V3ContentEvaluatorProvider {
  let providerCalls = 0
  return {
    name: provider.name,
    async complete(request: V3ContentEvaluatorRequest): Promise<string> {
      providerCalls += 1
      const raw = await provider.complete(request)
      try {
        parseV3ContentResponse(raw, {
          transcript: request.transcript,
          mechanicallyOwned: request.mechanicallyOwned,
          unreliableTranscriptSpans: request.unreliableTranscriptSpans,
        })
        traces.push({
          call: providerCalls,
          validation: 'passed',
          code: null,
          reason: null,
          metric: null,
          concisenessFindings: concisenessFindingShape(raw),
        })
      } catch (error) {
        traces.push({
          call: providerCalls,
          validation: 'failed',
          code: error instanceof V3ContentParseError ? error.code : 'internal_error',
          reason: error instanceof V3ContentParseError ? error.reason : null,
          metric: error instanceof V3ContentParseError ? error.metric : null,
          concisenessFindings: concisenessFindingShape(raw),
        })
      }
      return raw
    },
  }
}

loadEnvFile('.env.local')
const attemptId = process.argv[2]
const traceResponses = process.argv.includes('--trace-responses')
if (!attemptId) {
  throw new Error('Usage: npm run diagnose:v3-attempt -- <attempt-id> [--trace-responses]')
}

const client = new pg.Client({
  connectionString: required('SUPABASE_DB_URL', process.env.SUPABASE_DB_URL),
  ssl: { rejectUnauthorized: false },
})
await client.connect()
const result = await client.query(
  `select prompt_text, transcript, practice_mode, metrics, score, content_result
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
const responseTraces: ProviderResponseTrace[] = []
const provider = v3ContentEvaluatorFromModel(
  createDeepSeekModel(required('DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY)),
)
const content = await runV3ContentEvaluation({
  provider: traceResponses ? tracedProvider(provider, responseTraces) : provider,
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
console.log(`Stored score: ${typeof row.score === 'number' ? row.score : 'unavailable'} / 100`)
console.log(`Stored content audit: ${JSON.stringify(row.content_result ?? null)}`)
console.log(`Mechanical ownership: ${JSON.stringify(evidence.mechanicallyOwned)}`)
console.log(
  `Unreliable transcript spans: ${JSON.stringify(evidence.unreliableTranscriptSpans.map((span) => ({ ...span, quote: transcript.slice(span.start, span.end) })))}`,
)
console.log(`Content status: ${content.status}`)
console.log(`Provider calls: ${content.calls}`)
for (const trace of responseTraces) {
  console.log(`Provider response ${trace.call}: ${JSON.stringify(trace)}`)
}
console.log(`Content diagnostic: ${JSON.stringify(content.diagnostic ?? null)}`)
console.log(
  `Scored content metrics: ${Object.values(content.metrics).filter((metric) => metric.status === 'scored').length} / 6`,
)
console.log(
  `Content components: ${JSON.stringify(Object.fromEntries(Object.entries(content.metrics).map(([id, metric]) => [id, metric.component])))}`,
)
console.log(
  `Content points: ${JSON.stringify(Object.fromEntries(Object.entries(assembled.sections.what_you_said.metrics).map(([id, metric]) => [id, metric.earned_points === null ? null : `${metric.earned_points} / ${metric.max_points}`])))}`,
)
console.log(`Overall score: ${assembled.total_earned_points ?? 'unavailable'} / 100`)
console.log(`Pace: ${JSON.stringify(audio.metrics.pace.measurements)}`)
console.log(`Paused time: ${JSON.stringify(audio.metrics.paused_time.measurements)}`)
console.log(`Articulation: ${JSON.stringify(audio.metrics.articulation.measurements)}`)
console.log(`Energy: ${JSON.stringify(audio.metrics.energy.measurements)}`)
if (content.status !== 'checked') process.exitCode = 2
