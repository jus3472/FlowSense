import { describe, expect, it } from 'vitest'
import { validateOwnedAttemptAudioPath } from '@/lib/attempts/audio-path'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '10000000-0000-4000-8000-000000000099'
const ATTEMPT_ID = '20000000-0000-4000-8000-000000000002'
const SIBLING_ID = '20000000-0000-4000-8000-000000000003'
const MIME_TYPE = 'audio/webm;codecs=opus'
const STORAGE_PATH = `${USER_ID}/${ATTEMPT_ID}.webm`

function uploadMetrics(storagePath = STORAGE_PATH) {
  return {
    upload: { storage_path: storagePath, mime_type: MIME_TYPE },
    capture: { mime_type: MIME_TYPE },
  }
}

describe('owned attempt audio paths', () => {
  it('accepts the exact server-derived path and upload snapshot', () => {
    expect(
      validateOwnedAttemptAudioPath({
        userId: USER_ID,
        attemptId: ATTEMPT_ID,
        audioPath: STORAGE_PATH,
        metrics: uploadMetrics(),
      }),
    ).toEqual({ storagePath: STORAGE_PATH, mimeType: MIME_TYPE, snapshot: 'upload' })
  })

  it('rejects another user path even when stored upload metadata repeats it', () => {
    const path = `${OTHER_USER_ID}/${ATTEMPT_ID}.webm`
    expect(
      validateOwnedAttemptAudioPath({
        userId: USER_ID,
        attemptId: ATTEMPT_ID,
        audioPath: path,
        metrics: uploadMetrics(path),
      }),
    ).toBeNull()
  })

  it('rejects a sibling attempt path even when stored upload metadata repeats it', () => {
    const path = `${USER_ID}/${SIBLING_ID}.webm`
    expect(
      validateOwnedAttemptAudioPath({
        userId: USER_ID,
        attemptId: ATTEMPT_ID,
        audioPath: path,
        metrics: uploadMetrics(path),
      }),
    ).toBeNull()
  })

  it('fails closed for malformed or incomplete upload metadata', () => {
    for (const metrics of [
      { upload: 'invalid', capture: { mime_type: MIME_TYPE } },
      { upload: { storage_path: STORAGE_PATH }, capture: { mime_type: MIME_TYPE } },
      {
        upload: { storage_path: STORAGE_PATH, mime_type: 'audio/unknown' },
        capture: { mime_type: MIME_TYPE },
      },
      {
        upload: { storage_path: `${USER_ID}/${SIBLING_ID}.webm`, mime_type: MIME_TYPE },
        capture: { mime_type: MIME_TYPE },
      },
      {
        upload: { storage_path: STORAGE_PATH, mime_type: 'audio/mp4' },
        capture: { mime_type: MIME_TYPE },
      },
    ]) {
      expect(
        validateOwnedAttemptAudioPath({
          userId: USER_ID,
          attemptId: ATTEMPT_ID,
          audioPath: STORAGE_PATH,
          metrics,
        }),
      ).toBeNull()
    }
  })

  it('uses a valid legacy capture snapshot only when upload metadata is absent', () => {
    expect(
      validateOwnedAttemptAudioPath({
        userId: USER_ID,
        attemptId: ATTEMPT_ID,
        audioPath: STORAGE_PATH,
        metrics: { capture: { mime_type: MIME_TYPE } },
      }),
    ).toEqual({ storagePath: STORAGE_PATH, mimeType: MIME_TYPE, snapshot: 'capture' })

    expect(
      validateOwnedAttemptAudioPath({
        userId: USER_ID,
        attemptId: ATTEMPT_ID,
        audioPath: STORAGE_PATH,
        metrics: {},
      }),
    ).toBeNull()
  })
})
