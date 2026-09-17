import { describe, expect, it } from 'vitest'
import { readProgressAttemptRows, safeProgressErrorCode } from '@/lib/progress/load'
import { v3Snapshot } from './helpers/result-snapshots'

function row(overrides: Record<string, unknown> = {}) {
  const snapshot = v3Snapshot()
  return {
    id: 'attempt-1',
    finished_at: '2026-08-26T12:00:00.000Z',
    prompt_text: 'Describe one decision.',
    retry_of_attempt_id: null,
    score: snapshot.total_earned_points,
    section_scores: snapshot,
    practice_mode: 'practice',
    prompt_source: 'library',
    rubric_version: 'v3',
    status: 'done',
    ...overrides,
  }
}

describe('progress data loading boundary', () => {
  it('distinguishes an empty page from query failure', () => {
    expect(readProgressAttemptRows([], false)).toEqual({ status: 'ready', attempts: [] })
    expect(readProgressAttemptRows(null, true)).toEqual({ status: 'failure', reason: 'query' })
  })

  it('maps every authoritative field into a serializable shape', () => {
    const result = readProgressAttemptRows(
      [row({ prompt_source: 'custom', practice_mode: 'interview' })],
      false,
    )

    expect(result).toMatchObject({
      status: 'ready',
      attempts: [
        {
          id: 'attempt-1',
          finishedAt: '2026-08-26T12:00:00.000Z',
          promptText: 'Describe one decision.',
          retryOfAttemptId: null,
          practiceMode: 'interview',
          promptSource: 'custom',
          rubricVersion: 'v3',
          status: 'done',
        },
      ],
    })
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it('extracts Other only from a consistent custom General Speaking snapshot', () => {
    expect(
      readProgressAttemptRows(
        [
          row({
            prompt_source: 'custom',
            practice_mode: 'practice',
            practice_category: 'other',
          }),
        ],
        false,
      ),
    ).toMatchObject({
      status: 'ready',
      attempts: [{ category: 'other', practiceMode: 'practice', promptSource: 'custom' }],
    })
  })

  it.each([
    ['missing legacy metadata', undefined, 'interview', 'custom', 'interview'],
    ['invalid metadata', 'unknown', 'presentation', 'custom', 'presentation'],
    ['mode mismatch', 'conversation', 'interview', 'custom', 'interview'],
    ['Other on a library row', 'other', 'practice', 'library', 'practice'],
  ])(
    'falls back to the stored mode for %s',
    (_label, category, practiceMode, promptSource, expected) => {
      expect(
        readProgressAttemptRows(
          [
            row({
              prompt_source: promptSource,
              practice_mode: practiceMode,
              practice_category: category,
            }),
          ],
          false,
        ),
      ).toMatchObject({ status: 'ready', attempts: [{ category: expected }] })
    },
  )

  it.each([
    null,
    {},
    row({ id: '' }),
    row({ finished_at: null }),
    row({ finished_at: 'not-a-time' }),
    row({ prompt_text: '   ' }),
    row({ retry_of_attempt_id: 42 }),
    row({ score: 1.5 }),
    row({ practice_mode: 'unknown' }),
    row({ prompt_source: null }),
    row({ rubric_version: null }),
    row({ status: 'failed' }),
    row({ status: 'timed_out' }),
    row({ status: 'uploading' }),
    row({ status: 'transcribing' }),
    row({ status: 'scoring' }),
  ])('fails closed for an invalid response row %#', (value) => {
    expect(readProgressAttemptRows([value], false)).toEqual({
      status: 'failure',
      reason: 'invalid_response',
    })
  })

  it('returns every parsed row without imposing a business cap', () => {
    const rows = Array.from({ length: 501 }, (_, index) => row({ id: `attempt-${index}` }))
    const result = readProgressAttemptRows(rows, false)

    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.attempts).toHaveLength(501)
  })

  it('allows only bounded diagnostic codes', () => {
    expect(safeProgressErrorCode({ code: '42703', message: 'private details' })).toBe('42703')
    expect(safeProgressErrorCode({ code: 'bad code', message: 'private details' })).toBeUndefined()
    expect(safeProgressErrorCode({ message: 'private details' })).toBeUndefined()
  })
})
