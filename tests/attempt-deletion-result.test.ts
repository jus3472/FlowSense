import { describe, expect, it } from 'vitest'
import { deletedAttemptDestination, parseAttemptDeletionReceipt } from '@/lib/results/deletion'

describe('attempt deletion result', () => {
  it('parses the one-row transactional receipt', () => {
    expect(
      parseAttemptDeletionReceipt([
        {
          deleted: true,
          lesson_id: 'lesson-1',
          best_attempt_id: 'attempt-2',
          path_slug: 'interviews',
        },
      ]),
    ).toEqual({
      deleted: true,
      lessonId: 'lesson-1',
      bestAttemptId: 'attempt-2',
      pathSlug: 'interviews',
    })
  })

  it.each([null, [], {}, [{ deleted: 'yes' }], [{ deleted: false }]])(
    'rejects a malformed receipt: %j',
    (value) => {
      expect(parseAttemptDeletionReceipt(value)).toBeNull()
    },
  )

  it('redirects a structured lesson to its best surviving result', () => {
    expect(
      deletedAttemptDestination({
        deleted: true,
        lessonId: 'lesson-1',
        bestAttemptId: 'attempt-2',
        pathSlug: 'interviews',
      }),
    ).toBe('/attempts/attempt-2')
  })

  it('redirects a structured lesson without survivors to its Track', () => {
    expect(
      deletedAttemptDestination({
        deleted: true,
        lessonId: 'lesson-1',
        bestAttemptId: null,
        pathSlug: 'presentations',
      }),
    ).toBe('/practice/paths/presentations')
  })

  it('fails closed to History for non-structured and malformed path receipts', () => {
    expect(
      deletedAttemptDestination({
        deleted: true,
        lessonId: null,
        bestAttemptId: null,
        pathSlug: null,
      }),
    ).toBe('/history')
    expect(
      deletedAttemptDestination({
        deleted: true,
        lessonId: 'lesson-1',
        bestAttemptId: null,
        pathSlug: 'not-a-current-track',
      }),
    ).toBe('/history')
  })
})
