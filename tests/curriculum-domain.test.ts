import {
  CHAPTER_LEVELS,
  LESSON_KINDS,
  LESSON_STATES,
  PATH_SLUGS,
  type Stars,
} from '@/lib/curriculum/contracts'
import {
  lessonStateFor,
  mergeBestAttempt,
  selectBestAttempt,
  type LessonAttemptCandidate,
} from '@/lib/curriculum/progression'
import {
  PASSING_SCORE,
  THREE_STAR_SCORE,
  TWO_STAR_SCORE,
  isPassingScore,
  parseCurriculumScore,
  starsForScore,
} from '@/lib/curriculum/thresholds'
import { describe, expect, it } from 'vitest'

function attempt(attemptId: string, score: unknown, finishedAt: unknown): LessonAttemptCandidate {
  return { attemptId, score, finishedAt }
}

describe('curriculum contracts', () => {
  it('keeps the persisted identifiers stable', () => {
    expect(PATH_SLUGS).toEqual(['general-speaking', 'interviews', 'presentations', 'conversations'])
    expect(CHAPTER_LEVELS).toEqual(['beginner', 'intermediate', 'advanced'])
    expect(LESSON_KINDS).toEqual(['lesson', 'checkpoint'])
    expect(LESSON_STATES).toEqual(['locked', 'available', 'retry_required', 'passed'])
  })
})

describe('curriculum score thresholds', () => {
  it('uses the fixed pass and star boundaries', () => {
    expect(PASSING_SCORE).toBe(70)
    expect(TWO_STAR_SCORE).toBe(80)
    expect(THREE_STAR_SCORE).toBe(90)

    const cases: readonly [number, Stars][] = [
      [0, 0],
      [69, 0],
      [70, 1],
      [79, 1],
      [80, 2],
      [89, 2],
      [90, 3],
      [100, 3],
    ]
    for (const [score, stars] of cases) {
      expect(parseCurriculumScore(score)).toBe(score)
      expect(starsForScore(score)).toBe(stars)
      expect(isPassingScore(score)).toBe(score >= PASSING_SCORE)
    }
  })

  it.each([null, undefined, -1, 101, 69.5, Number.NaN, Number.POSITIVE_INFINITY, '70'])(
    'keeps an invalid or neutral score fail-closed: %s',
    (score) => {
      expect(parseCurriculumScore(score)).toBeNull()
      expect(starsForScore(score)).toBe(0)
      expect(isPassingScore(score)).toBe(false)
    },
  )

  it('shows zero stars while a null score remains neutral', () => {
    expect(parseCurriculumScore(null)).toBeNull()
    expect(starsForScore(null)).toBe(0)
  })
})

describe('lesson progression', () => {
  it('maps unlocked neutral, retry, and passing scores to states', () => {
    expect(lessonStateFor({ unlocked: true, bestScore: null })).toBe('available')
    expect(lessonStateFor({ unlocked: true, bestScore: 0 })).toBe('retry_required')
    expect(lessonStateFor({ unlocked: true, bestScore: 69 })).toBe('retry_required')
    expect(lessonStateFor({ unlocked: true, bestScore: 70 })).toBe('passed')
    expect(lessonStateFor({ unlocked: true, bestScore: 100 })).toBe('passed')
    expect(lessonStateFor({ unlocked: true, bestScore: 70.5 })).toBe('available')
  })

  it('lets a lock override every score state', () => {
    expect(lessonStateFor({ unlocked: false, bestScore: null })).toBe('locked')
    expect(lessonStateFor({ unlocked: false, bestScore: 69 })).toBe('locked')
    expect(lessonStateFor({ unlocked: false, bestScore: 100 })).toBe('locked')
  })

  it('ignores neutral and invalid scores while selecting the highest valid attempt', () => {
    const result = selectBestAttempt([
      attempt('neutral', null, '2026-08-28T10:00:00.000Z'),
      attempt('fraction', 90.5, '2026-08-28T11:00:00.000Z'),
      attempt('out-of-range', 101, '2026-08-28T12:00:00.000Z'),
      attempt('valid', 80, '2026-08-28T09:00:00.000Z'),
    ])

    expect(result).toEqual({
      attemptId: 'valid',
      score: 80,
      finishedAt: '2026-08-28T09:00:00.000Z',
    })
    expect(selectBestAttempt([attempt('neutral', null, null)])).toBeNull()
  })

  it('keeps a higher score when a newer retry is lower', () => {
    const result = selectBestAttempt([
      attempt('passed-first', 90, '2026-08-27T10:00:00.000Z'),
      attempt('lower-retry', 60, '2026-08-28T10:00:00.000Z'),
    ])

    expect(result?.attemptId).toBe('passed-first')
    expect(result?.score).toBe(90)
    expect(lessonStateFor({ unlocked: true, bestScore: result?.score })).toBe('passed')
  })

  it('uses the newest valid finish time and then attempt id for equal scores', () => {
    const result = selectBestAttempt([
      attempt('older', 80, '2026-08-27T10:00:00.000Z'),
      attempt('newer', 80, '2026-08-28T10:00:00.000Z'),
      attempt('invalid-time-z', 80, 'not-a-date'),
    ])
    const deterministicFallback = selectBestAttempt([
      attempt('attempt-a', 70, null),
      attempt('attempt-b', 70, 'not-a-date'),
    ])

    expect(result?.attemptId).toBe('newer')
    expect(deterministicFallback?.attemptId).toBe('attempt-b')
    expect(deterministicFallback?.finishedAt).toBeNull()
  })

  it('is deterministic regardless of candidate order', () => {
    const candidates = [
      attempt('attempt-a', 80, '2026-08-28T10:00:00.000Z'),
      attempt('attempt-b', 80, '2026-08-28T10:00:00.000Z'),
      attempt('higher', 90, '2026-08-27T10:00:00.000Z'),
    ]

    expect(selectBestAttempt(candidates)).toEqual(selectBestAttempt([...candidates].reverse()))
  })

  it('merges lower, equal, and higher retries without reducing the best score', () => {
    const current = attempt('current', 80, '2026-08-27T10:00:00.000Z')
    const lower = mergeBestAttempt(current, attempt('lower', 69, '2026-08-28T10:00:00.000Z'))
    const equal = mergeBestAttempt(current, attempt('equal', 80, '2026-08-28T10:00:00.000Z'))
    const higher = mergeBestAttempt(current, attempt('higher', 90, '2026-08-28T10:00:00.000Z'))
    const invalid = mergeBestAttempt(current, attempt('invalid', Number.NaN, null))

    expect(lower).toMatchObject({ attemptId: 'current', score: 80 })
    expect(equal).toMatchObject({ attemptId: 'equal', score: 80 })
    expect(higher).toMatchObject({ attemptId: 'higher', score: 90 })
    expect(invalid).toMatchObject({ attemptId: 'current', score: 80 })
  })
})
