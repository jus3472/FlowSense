import { dataEmpty, dataFailure, dataReady } from '@/lib/data/outcome'
import {
  invalidExplicitRecordIntent,
  resolveLibraryPromptSession,
  resolveRetrySession,
} from '@/lib/practice/resolution'
import type { LibraryPrompt } from '@/lib/prompts/selection'
import { describe, expect, it, vi } from 'vitest'

const PROMPT_ID = '11111111-1111-4111-8111-111111111111'
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222'

const PROMPT: LibraryPrompt = {
  id: PROMPT_ID,
  text: 'Describe a choice you made recently.',
  mode: 'practice',
  difficulty: 'beginner',
  targetDurationSeconds: 30,
  collectionId: 'storytelling',
}

describe('explicit practice-session resolution', () => {
  it('rejects contradictory explicit retry or prompt intent', () => {
    expect(invalidExplicitRecordIntent({ retry: ATTEMPT_ID, prompt: PROMPT_ID })).toBe('retry')
    expect(invalidExplicitRecordIntent({ retry: ATTEMPT_ID, mode: 'practice' })).toBe('retry')
    expect(invalidExplicitRecordIntent({ prompt: PROMPT_ID, mode: 'practice' })).toBe('prompt')
  })

  it('rejects malformed, repeated, and contradictory explicit custom intent', () => {
    expect(invalidExplicitRecordIntent({ custom: 'bad' })).toBe('custom')
    expect(invalidExplicitRecordIntent({ custom: ['1'] })).toBe('custom')
    expect(invalidExplicitRecordIntent({ custom: '1', mode: 'practice' })).toBe('custom')
    expect(invalidExplicitRecordIntent({ custom: '1', prompt: PROMPT_ID })).toBe('custom')
    expect(invalidExplicitRecordIntent({ custom: '1', retry: ATTEMPT_ID })).toBe('custom')
    expect(invalidExplicitRecordIntent({ custom: '1' })).toBeNull()
  })

  it('does not invoke a loader when no explicit intent is present', async () => {
    const loadAttempt = vi.fn()
    const loadPrompt = vi.fn()

    await expect(resolveRetrySession(undefined, loadAttempt)).resolves.toEqual({ status: 'none' })
    await expect(resolveLibraryPromptSession(undefined, loadPrompt)).resolves.toEqual({
      status: 'none',
    })
    expect(loadAttempt).not.toHaveBeenCalled()
    expect(loadPrompt).not.toHaveBeenCalled()
  })

  it.each([[''], ['not-a-uuid'], [[ATTEMPT_ID, ATTEMPT_ID]]])(
    'fails closed for a malformed or repeated retry value',
    async (value) => {
      const loader = vi.fn()
      await expect(resolveRetrySession(value, loader)).resolves.toEqual({
        status: 'unavailable',
      })
      expect(loader).not.toHaveBeenCalled()
    },
  )

  it('keeps missing or unauthorized retries unavailable and query failures explicit', async () => {
    await expect(resolveRetrySession(ATTEMPT_ID, async () => dataEmpty())).resolves.toEqual({
      status: 'unavailable',
    })
    await expect(resolveRetrySession(ATTEMPT_ID, async () => dataFailure())).resolves.toEqual({
      status: 'failure',
    })
  })

  it('uses the owned retry snapshot without loading the public prompt row', async () => {
    const loadAttempt = vi.fn(async () =>
      dataReady({
        id: ATTEMPT_ID,
        prompt_id: null,
        prompt_text: PROMPT.text,
        practice_mode: 'practice',
        prompt_source: 'library',
        prompt_difficulty: 'beginner',
        metrics: { practice: { target_duration_seconds: 30 } },
        status: 'done',
      }),
    )

    await expect(resolveRetrySession(ATTEMPT_ID, loadAttempt)).resolves.toEqual({
      status: 'ready',
      session: {
        promptText: PROMPT.text,
        promptId: null,
        mode: 'practice',
        difficulty: 'beginner',
        source: 'library',
        targetDurationSeconds: 30,
        retryOfAttemptId: ATTEMPT_ID,
      },
    })
    expect(loadAttempt).toHaveBeenCalledOnce()
    expect(loadAttempt).toHaveBeenCalledWith(ATTEMPT_ID)
  })

  it.each(['done', 'failed', 'timed_out'] as const)(
    'allows a %s owned parent to reach the recorder',
    async (status) => {
      const outcome = await resolveRetrySession(ATTEMPT_ID, async () =>
        dataReady({
          id: ATTEMPT_ID,
          prompt_id: null,
          prompt_text: PROMPT.text,
          practice_mode: 'practice',
          prompt_source: 'library',
          prompt_difficulty: 'beginner',
          metrics: { practice: { target_duration_seconds: 30 } },
          status,
        }),
      )

      expect(outcome.status).toBe('ready')
    },
  )

  it.each(['uploading', 'transcribing', 'scoring', 'unknown', null] as const)(
    'blocks a %s parent before rendering the recorder',
    async (status) => {
      await expect(
        resolveRetrySession(ATTEMPT_ID, async () =>
          dataReady({
            id: ATTEMPT_ID,
            prompt_id: null,
            prompt_text: PROMPT.text,
            practice_mode: 'practice',
            prompt_source: 'library',
            prompt_difficulty: 'beginner',
            metrics: { practice: { target_duration_seconds: 30 } },
            status,
          }),
        ),
      ).resolves.toEqual({ status: 'unavailable' })
    },
  )

  it('distinguishes missing direct prompts from prompt-query failures', async () => {
    await expect(resolveLibraryPromptSession(PROMPT_ID, async () => dataEmpty())).resolves.toEqual({
      status: 'unavailable',
    })
    await expect(
      resolveLibraryPromptSession(PROMPT_ID, async () => dataFailure()),
    ).resolves.toEqual({ status: 'failure' })
  })

  it('builds direct prompt sessions from the validated library DTO', async () => {
    await expect(
      resolveLibraryPromptSession(PROMPT_ID, async () => dataReady(PROMPT)),
    ).resolves.toEqual({
      status: 'ready',
      session: {
        promptText: PROMPT.text,
        promptId: PROMPT_ID,
        mode: 'practice',
        difficulty: 'beginner',
        source: 'library',
        targetDurationSeconds: 30,
        retryOfAttemptId: null,
      },
    })
  })
})
