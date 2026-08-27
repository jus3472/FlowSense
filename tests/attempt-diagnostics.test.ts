import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { logAttemptDiagnostic } from '@/lib/attempts/server'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const PRIVATE_PROMPT = 'Private prompt text should not be logged.'
const PRIVATE_TRANSCRIPT = 'Private transcript text should not be logged.'
const PRIVATE_PATH = `${ATTEMPT_ID}/private-recording.webm`
const PRIVATE_SIGNED_URL = 'https://private.example.test/signed-recording'
const PRIVATE_ERROR_MESSAGE = 'private database and storage error text'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('attempt diagnostics', () => {
  it('retains bounded failure metadata without logging private error fields', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const providerError = {
      code: 'PGRST500',
      message: PRIVATE_ERROR_MESSAGE,
      prompt: PRIVATE_PROMPT,
      transcript: PRIVATE_TRANSCRIPT,
      path: PRIVATE_PATH,
      signedUrl: PRIVATE_SIGNED_URL,
    }

    logAttemptDiagnostic(
      'load_attempt_result',
      'attempt_result_read_failed',
      ATTEMPT_ID,
      providerError,
    )

    expect(consoleError).toHaveBeenCalledExactlyOnceWith('[attempts] operation failed', {
      operation: 'load_attempt_result',
      code: 'attempt_result_read_failed',
      attemptId: ATTEMPT_ID,
      diagnostic: 'PGRST500',
    })

    const emittedDiagnostic = JSON.stringify(consoleError.mock.calls)
    for (const privateValue of [
      PRIVATE_ERROR_MESSAGE,
      PRIVATE_PROMPT,
      PRIVATE_TRANSCRIPT,
      PRIVATE_PATH,
      PRIVATE_SIGNED_URL,
    ]) {
      expect(emittedDiagnostic).not.toContain(privateValue)
    }
  })
})
