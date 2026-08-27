import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readProgressAttemptRows, safeProgressErrorCode } from '@/lib/progress/load'
import { v2Snapshot } from './helpers/result-snapshots'

describe('progress data loading boundary', () => {
  it('distinguishes a valid empty result from a query failure', () => {
    expect(readProgressAttemptRows([], false, 200)).toEqual({
      status: 'ready',
      attempts: [],
      truncated: false,
    })
    expect(readProgressAttemptRows(null, true, 200)).toEqual({
      status: 'failure',
      reason: 'query',
    })
  })

  it('maps valid rows into a serializable presentation shape', () => {
    const result = readProgressAttemptRows(
      [
        {
          id: 'attempt-1',
          created_at: '2026-08-26T12:00:00.000Z',
          retry_of_attempt_id: null,
          status: 'done',
          section_scores: v2Snapshot({ notCheckedCategory: 'grammar' }),
        },
      ],
      false,
      200,
    )

    expect(result.status).toBe('ready')
    expect(() => JSON.stringify(result)).not.toThrow()
    if (result.status === 'ready') {
      expect(result.truncated).toBe(false)
      expect(result.attempts[0]).toMatchObject({
        id: 'attempt-1',
        retryOfAttemptId: null,
      })
    }
  })

  it.each([
    [null],
    [{}],
    [{ id: '', created_at: '2026-08-26T12:00:00.000Z', retry_of_attempt_id: null, status: 'done' }],
    [{ id: 'one', created_at: 42, retry_of_attempt_id: null, status: 'done' }],
    [
      {
        id: 'one',
        created_at: '2026-08-26T12:00:00.000Z',
        retry_of_attempt_id: 42,
        status: 'done',
      },
    ],
  ])('fails closed for an invalid response shape', (data) => {
    expect(readProgressAttemptRows(data, false, 200)).toEqual({
      status: 'failure',
      reason: 'invalid_response',
    })
  })

  it.each(['uploading', 'transcribing', 'scoring', 'failed', 'timed_out'])(
    'rejects a non-completed %s row at the progress parsing boundary',
    (status) => {
      expect(
        readProgressAttemptRows(
          [
            {
              id: 'attempt-1',
              created_at: '2026-08-26T12:00:00.000Z',
              retry_of_attempt_id: null,
              status,
              section_scores: v2Snapshot(),
            },
          ],
          false,
          200,
        ),
      ).toEqual({ status: 'failure', reason: 'invalid_response' })
    },
  )

  it('allows only bounded diagnostic codes', () => {
    expect(safeProgressErrorCode({ code: '42703', message: 'private details' })).toBe('42703')
    expect(safeProgressErrorCode({ code: 'bad code', message: 'private details' })).toBeUndefined()
    expect(safeProgressErrorCode({ message: 'private details' })).toBeUndefined()
  })

  it('uses one lookahead row to disclose a bounded completed-attempt window', () => {
    const rows = ['newest', 'middle', 'oldest'].map((id, index) => ({
      id,
      created_at: `2026-08-2${6 - index}T12:00:00.000Z`,
      retry_of_attempt_id: null,
      status: 'done',
      section_scores: v2Snapshot(),
    }))

    expect(readProgressAttemptRows(rows, false, 2)).toMatchObject({
      status: 'ready',
      truncated: true,
      attempts: [{ id: 'newest' }, { id: 'middle' }],
    })
  })

  it('keeps the server query user-scoped and logging free of raw provider messages', () => {
    const source = readFileSync('src/lib/progress/server.ts', 'utf8')

    expect(source).toContain(".eq('user_id', userId)")
    expect(source).toContain(".eq('status', 'done')")
    expect(source).toContain('retry_of_attempt_id, status')
    expect(source).toContain(".order('created_at', { ascending: false })")
    expect(source).toContain(".order('id', { ascending: false })")
    expect(source).toContain('.limit(PROGRESS_COMPLETED_ATTEMPT_LIMIT + 1)')
    expect(source).toContain('safeProgressErrorCode(error)')
    expect(source).not.toContain('error.message')
    expect(source).not.toContain('Task B')
  })
})
