import { describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPT_PROMPT_TEXT_LENGTH,
  parseCreateAttemptPayload,
} from '@/lib/recording/attempt-payload'

const VALID = {
  promptId: '0df9c03d-13cf-4bf5-96d9-0e3524e1524a',
  promptText: 'Describe your ideal weekend.',
  mimeType: 'audio/webm;codecs=opus',
  durationMs: 12_400.4,
}

describe('parseCreateAttemptPayload', () => {
  it('trims prompt text and preserves current UUID and duration behavior', () => {
    expect(parseCreateAttemptPayload({ ...VALID, promptText: ` ${VALID.promptText} ` })).toEqual({
      ok: true,
      value: { ...VALID, promptText: VALID.promptText, durationMs: 12_400 },
    })
  })

  it('keeps an invalid or missing prompt UUID as null for client compatibility', () => {
    expect(parseCreateAttemptPayload({ ...VALID, promptId: 'not-a-uuid' })).toMatchObject({
      ok: true,
      value: { promptId: null },
    })
    expect(parseCreateAttemptPayload({ ...VALID, promptId: null })).toMatchObject({
      ok: true,
      value: { promptId: null },
    })
  })

  it.each([
    ['a non-object payload', null, 'The request body was malformed.'],
    ['a blank prompt', { ...VALID, promptText: ' \n ' }, 'The prompt text was missing.'],
    [
      'a prompt above the limit',
      { ...VALID, promptText: 'a'.repeat(MAX_ATTEMPT_PROMPT_TEXT_LENGTH + 1) },
      'Your prompt is too long.',
    ],
    ['an unsupported MIME type', { ...VALID, mimeType: 'audio/wav' }, 'The recording format was not supported.'],
  ])('rejects %s', (_label, payload, error) => {
    expect(parseCreateAttemptPayload(payload)).toEqual({ ok: false, error })
  })

  it('accepts a prompt exactly at the length limit', () => {
    expect(
      parseCreateAttemptPayload({ ...VALID, promptText: 'a'.repeat(MAX_ATTEMPT_PROMPT_TEXT_LENGTH) }),
    ).toMatchObject({ ok: true })
  })
})
