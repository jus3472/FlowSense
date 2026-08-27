import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readProgressAttemptRows, safeProgressErrorCode } from '@/lib/progress/load'
import { v2Snapshot } from './helpers/result-snapshots'

describe('progress data loading boundary', () => {
  it('distinguishes a valid empty result from a query failure', () => {
    expect(readProgressAttemptRows([], false)).toEqual({ status: 'ready', attempts: [] })
    expect(readProgressAttemptRows(null, true)).toEqual({ status: 'failure', reason: 'query' })
  })

  it('maps valid rows into a serializable presentation shape', () => {
    const result = readProgressAttemptRows(
      [
        {
          id: 'attempt-1',
          created_at: '2026-08-26T12:00:00.000Z',
          retry_of_attempt_id: null,
          section_scores: v2Snapshot({ notCheckedCategory: 'grammar' }),
        },
      ],
      false,
    )

    expect(result.status).toBe('ready')
    expect(() => JSON.stringify(result)).not.toThrow()
    if (result.status === 'ready') {
      expect(result.attempts[0]).toMatchObject({
        id: 'attempt-1',
        retryOfAttemptId: null,
      })
    }
  })

  it.each([
    [null],
    [{}],
    [{ id: '', created_at: '2026-08-26T12:00:00.000Z', retry_of_attempt_id: null }],
    [{ id: 'one', created_at: 42, retry_of_attempt_id: null }],
    [{ id: 'one', created_at: '2026-08-26T12:00:00.000Z', retry_of_attempt_id: 42 }],
  ])('fails closed for an invalid response shape', (data) => {
    expect(readProgressAttemptRows(data, false)).toEqual({
      status: 'failure',
      reason: 'invalid_response',
    })
  })

  it('allows only bounded diagnostic codes', () => {
    expect(safeProgressErrorCode({ code: '42703', message: 'private details' })).toBe('42703')
    expect(safeProgressErrorCode({ code: 'bad code', message: 'private details' })).toBeUndefined()
    expect(safeProgressErrorCode({ message: 'private details' })).toBeUndefined()
  })

  it('keeps the server query user-scoped and logging free of raw provider messages', () => {
    const source = readFileSync('src/lib/progress/server.ts', 'utf8')

    expect(source).toContain(".eq('user_id', userId)")
    expect(source).toContain('safeProgressErrorCode(error)')
    expect(source).not.toContain('error.message')
    expect(source).toContain('Task B can add `status = done`')
  })
})
