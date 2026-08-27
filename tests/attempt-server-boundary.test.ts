import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ROUTES = [
  'src/app/api/attempts/route.ts',
  'src/app/api/attempts/[id]/route.ts',
  'src/app/api/attempts/[id]/disputes/route.ts',
  'src/app/api/transcribe/route.ts',
  'src/app/api/score/route.ts',
]

describe('server-owned attempt boundary', () => {
  it('authenticates every mutation route before using the admin data boundary', () => {
    for (const path of ROUTES) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).toContain('authenticatedAttemptContext()')
      expect(source, path).not.toContain("from '@/lib/supabase/server'")
    }
  })

  it('keeps every existing-attempt mutation explicitly user scoped', () => {
    for (const path of ROUTES.slice(1)) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).toContain(".eq('user_id', userId)")
    }
  })

  it('selects the rubric on the server and enforces the idempotency key', () => {
    const createRoute = readFileSync('src/app/api/attempts/route.ts', 'utf8')
    const browserApi = readFileSync('src/lib/recording/api.ts', 'utf8')
    expect(createRoute).toContain('rubric_version: RUBRIC_VERSION')
    expect(createRoute).toContain(".eq('client_request_id', payload.clientRequestId)")
    expect(createRoute).toContain(".eq('active', true)")
    expect(createRoute).toContain('retryCreationSession(payload, parent)')
    expect(browserApi).toContain('requestIdsBySession')
    expect(browserApi).toContain('clientRequestId = requestIdForSession(session)')
  })

  it('persists transcript quality and never logs raw provider bodies', () => {
    const transcribeRoute = readFileSync('src/app/api/transcribe/route.ts', 'utf8')
    expect(transcribeRoute).toContain('...deepgramQualityMetrics(parsed)')
    expect(transcribeRoute).toContain('duration_seconds: parsed.durationSeconds')
    expect(transcribeRoute).not.toContain('DEEPGRAM_DEBUG')
    expect(transcribeRoute).not.toContain('JSON.stringify(raw)')
  })

  it('keeps v2 writes atomic and disputes outside stored attempt snapshots', () => {
    const scoreRoute = readFileSync('src/app/api/score/route.ts', 'utf8')
    const disputeRoute = readFileSync('src/app/api/attempts/[id]/disputes/route.ts', 'utf8')
    expect(scoreRoute).toContain(
      "transitionOwnedAttempt(admin, userId, attemptId, ['scoring'], 'done'",
    )
    expect(scoreRoute).toContain(".eq('content_result->>status', 'not_checked')")
    expect(disputeRoute).not.toContain(".from('attempts')\n    .update")
    expect(disputeRoute).toContain("admin.from('note_feedback').insert")
  })
})
