import { describe, expect, it } from 'vitest'
import { attemptRetryHref } from '@/lib/attempts/retry-href'

const ATTEMPT_ID = '10000000-0000-4000-8000-000000000001'
const LESSON_ID = '20000000-0000-4000-8000-000000000002'

describe('attempt retry routes', () => {
  it('routes current unstructured attempts through the generic retry entry point', () => {
    expect(attemptRetryHref({ attemptId: ATTEMPT_ID, lessonId: null, metrics: {} })).toBe(
      `/record?retry=${ATTEMPT_ID}`,
    )
  })

  it('routes current structured attempts back through their validated lesson entry point', () => {
    expect(
      attemptRetryHref({
        attemptId: ATTEMPT_ID,
        lessonId: LESSON_ID,
        metrics: {
          creation: {
            curriculum: {
              lesson_id: LESSON_ID,
              path_slug: 'interviews',
              lesson_slug: 'interviews-beginner-01-skill-1',
            },
          },
        },
      }),
    ).toBe(
      `/practice/paths/interviews/lessons/interviews-beginner-01-skill-1/record?retry=${ATTEMPT_ID}`,
    )
  })

  it('fails closed for stale or incomplete structured retry metadata', () => {
    expect(attemptRetryHref({ attemptId: ATTEMPT_ID, lessonId: LESSON_ID, metrics: {} })).toBeNull()
    expect(
      attemptRetryHref({
        attemptId: ATTEMPT_ID,
        lessonId: LESSON_ID,
        metrics: {
          creation: {
            curriculum: {
              lesson_id: '30000000-0000-4000-8000-000000000003',
              path_slug: 'interviews',
              lesson_slug: 'interviews-beginner-01-skill-1',
            },
          },
        },
      }),
    ).toBeNull()
  })
})
