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
    expect(createRoute.indexOf(".eq('client_request_id', payload.clientRequestId)")).toBeLessThan(
      createRoute.indexOf('const resolved = await authoritativeSession'),
    )
    expect(createRoute).toContain('storedAttemptReuse(existingResult.data')
  })

  it('validates an exact owned path before every service-role storage operation', () => {
    const attemptRoute = readFileSync('src/app/api/attempts/[id]/route.ts', 'utf8')
    const transcribeRoute = readFileSync('src/app/api/transcribe/route.ts', 'utf8')
    const scoreRoute = readFileSync('src/app/api/score/route.ts', 'utf8')

    for (const source of [attemptRoute, transcribeRoute, scoreRoute]) {
      expect(source).toContain('validateOwnedAttemptAudioPath')
    }
    expect(attemptRoute).toContain('.remove([ownedAudio.storagePath])')
    expect(attemptRoute).not.toContain('.remove([attempt.audio_path])')
    expect(transcribeRoute).toContain('.download(ownedAudio.storagePath)')
    expect(transcribeRoute).not.toContain('.download(attempt.audio_path)')
    expect(scoreRoute).toContain('audioPath: ownedAudio?.storagePath ?? null')
    expect(scoreRoute).toContain(
      'analyseClarity(transcriptWords, capture, pronunciation, transcript)',
    )
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

  it('rejects unknown rubric versions before v2 reuse or legacy dispatch', () => {
    const scoreRoute = readFileSync('src/app/api/score/route.ts', 'utf8')
    const guard = scoreRoute.indexOf("rubricKind === 'unsupported'")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(scoreRoute.indexOf('if (shouldReuseStoredV2Score'))
    expect(scoreRoute).toContain('ATTEMPT_FAILURE_CODES.unsupportedRubricVersion')
    expect(scoreRoute).toContain("if (rubricKind === 'v2' && v2Mode)")
  })
})
