import {
  MAX_TARGET_DURATION_SECONDS,
  MIN_TARGET_DURATION_SECONDS,
  parsePracticeSessionDescriptor,
  retrySessionFromAttempt,
} from '@/lib/practice/session'
import { describe, expect, it } from 'vitest'

const PROMPT_ID = '11111111-1111-4111-8111-111111111111'
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222'

const LIBRARY_SESSION = {
  promptText: 'Describe a small change you would make.',
  promptId: PROMPT_ID,
  mode: 'practice',
  difficulty: 'beginner',
  source: 'library',
  targetDurationSeconds: 30,
  retryOfAttemptId: null,
}

describe('practice session descriptor', () => {
  it('accepts a complete library session', () => {
    expect(parsePracticeSessionDescriptor(LIBRARY_SESSION)).toEqual(LIBRARY_SESSION)
  })

  it.each([
    ['library session without a prompt id', { ...LIBRARY_SESSION, promptId: null }],
    ['custom session with a prompt id', { ...LIBRARY_SESSION, source: 'custom' }],
    ['invalid mode', { ...LIBRARY_SESSION, mode: 'debate' }],
    ['invalid retry id', { ...LIBRARY_SESSION, retryOfAttemptId: 'not-a-uuid' }],
    [
      'too-short target duration',
      { ...LIBRARY_SESSION, targetDurationSeconds: MIN_TARGET_DURATION_SECONDS - 1 },
    ],
    [
      'too-long target duration',
      { ...LIBRARY_SESSION, targetDurationSeconds: MAX_TARGET_DURATION_SECONDS + 1 },
    ],
  ])('rejects a %s', (_label, value) => {
    expect(parsePracticeSessionDescriptor(value)).toBeNull()
  })

  it('builds a retry from the stored prompt snapshot and preserves its metadata', () => {
    expect(
      retrySessionFromAttempt({
        id: ATTEMPT_ID,
        prompt_id: PROMPT_ID,
        prompt_text: LIBRARY_SESSION.promptText,
        practice_mode: 'interview',
        prompt_source: 'library',
        prompt_difficulty: 'advanced',
        metrics: {
          practice: { target_duration_seconds: 45, additional_context: 'Keep it concise.' },
        },
      }),
    ).toEqual({
      ...LIBRARY_SESSION,
      mode: 'interview',
      difficulty: 'advanced',
      targetDurationSeconds: 45,
      retryOfAttemptId: ATTEMPT_ID,
      additionalContext: 'Keep it concise.',
    })
  })

  it('returns no retry session for an unavailable or contradictory stored snapshot', () => {
    expect(retrySessionFromAttempt(null)).toBeNull()
    expect(
      retrySessionFromAttempt({
        id: ATTEMPT_ID,
        prompt_id: null,
        prompt_text: LIBRARY_SESSION.promptText,
        prompt_source: 'library',
      }),
    ).toBeNull()
  })
})
