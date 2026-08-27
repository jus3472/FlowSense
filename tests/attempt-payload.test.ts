import { describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPT_PROMPT_TEXT_LENGTH,
  parseCreateAttemptPayload,
} from '@/lib/recording/attempt-payload'

const VALID = {
  clientRequestId: '8c567083-a9f7-4e4f-8e8d-094698d9fa8d',
  promptId: '0df9c03d-13cf-4bf5-96d9-0e3524e1524a',
  promptText: 'Describe your ideal weekend.',
  mimeType: 'audio/webm;codecs=opus',
  durationMs: 12_400.4,
  mode: 'practice',
  difficulty: 'beginner',
  source: 'library',
  targetDurationSeconds: 30,
  retryOfAttemptId: null,
}

describe('parseCreateAttemptPayload', () => {
  it('trims prompt text and preserves session metadata and duration behavior', () => {
    expect(parseCreateAttemptPayload({ ...VALID, promptText: ` ${VALID.promptText} ` })).toEqual({
      ok: true,
      value: { ...VALID, promptText: VALID.promptText, durationMs: 12_400 },
    })
  })

  it('rejects invalid UUIDs and source combinations instead of changing them', () => {
    expect(parseCreateAttemptPayload({ ...VALID, promptId: 'not-a-uuid' })).toMatchObject({
      ok: false,
    })
    expect(parseCreateAttemptPayload({ ...VALID, promptId: null })).toMatchObject({ ok: false })
    expect(
      parseCreateAttemptPayload({ ...VALID, source: 'custom', promptId: VALID.promptId }),
    ).toMatchObject({ ok: false })
    expect(parseCreateAttemptPayload({ ...VALID, source: 'custom', promptId: null })).toMatchObject(
      { ok: true, value: { promptId: null, source: 'custom' } },
    )
  })

  it.each([
    ['a non-object payload', null, 'The request body was malformed.'],
    ['a blank prompt', { ...VALID, promptText: ' \n ' }, 'The prompt text was missing.'],
    [
      'a prompt above the limit',
      { ...VALID, promptText: 'a'.repeat(MAX_ATTEMPT_PROMPT_TEXT_LENGTH + 1) },
      'Your prompt is too long.',
    ],
    [
      'an unsupported MIME type',
      { ...VALID, mimeType: 'audio/wav' },
      'The recording format was not supported.',
    ],
    [
      'an invalid recording request id',
      { ...VALID, clientRequestId: 'request-1' },
      'The recording request id was invalid.',
    ],
  ])('rejects %s', (_label, payload, error) => {
    expect(parseCreateAttemptPayload(payload)).toEqual({ ok: false, error })
  })

  it('accepts a prompt exactly at the length limit', () => {
    expect(
      parseCreateAttemptPayload({
        ...VALID,
        promptText: 'a'.repeat(MAX_ATTEMPT_PROMPT_TEXT_LENGTH),
      }),
    ).toMatchObject({ ok: true })
  })

  it('does not accept a browser-selected rubric field into the parsed payload', () => {
    const result = parseCreateAttemptPayload({ ...VALID, rubricVersion: 'v1' })
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.value).not.toHaveProperty('rubricVersion')
  })
})
