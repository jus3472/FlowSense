import {
  CHAPTER_LEVELS,
  PATH_MODES,
  PATH_POSITIONS,
  type CurriculumLessonLink,
  type CurriculumPathDefinition,
  type PathSlug,
  type PersistedLessonProgress,
} from '@/lib/curriculum/contracts'
import { buildCurriculumPathProgress, mergeBestAttempt } from '@/lib/curriculum/progression'
import { buildStructuredResultNavigation } from '@/lib/curriculum/result-navigation'
import { describe, expect, it } from 'vitest'

function makePath(slug: PathSlug = 'interviews'): CurriculumPathDefinition {
  const pathId = `path-${slug}`
  return {
    id: pathId,
    slug,
    title: slug,
    mode: PATH_MODES[slug],
    position: PATH_POSITIONS[slug],
    active: true,
    chapters: CHAPTER_LEVELS.map((level, chapterIndex) => {
      const chapterId = `${pathId}-${level}`
      return {
        id: chapterId,
        pathId,
        level,
        title: level,
        position: chapterIndex + 1,
        active: true,
        lessons: Array.from({ length: 10 }, (_, lessonIndex) => {
          const position = lessonIndex + 1
          return {
            id: `${slug}-${level}-${position}`,
            chapterId,
            slug: `${slug}-${level}-${String(position).padStart(2, '0')}-skill-${position}`,
            title: `${level} ${position}`,
            skillFocus: `skill ${position}`,
            position,
            checkpoint: position === 10,
            promptId: `prompt-${slug}-${level}-${position}`,
            active: true,
          }
        }),
      }
    }),
  }
}

function lessonAt(path: CurriculumPathDefinition, index: number) {
  const chapter = path.chapters[Math.floor(index / 10)]
  const lesson = chapter?.lessons[index % 10]
  if (!chapter || !lesson) throw new Error('Test lesson index is outside the curriculum.')
  return { chapter, lesson }
}

function linkAt(path: CurriculumPathDefinition, index: number): CurriculumLessonLink {
  const { chapter, lesson } = lessonAt(path, index)
  return {
    id: lesson.id,
    slug: lesson.slug,
    pathSlug: path.slug,
    level: chapter.level,
    position: lesson.position,
  }
}

function progressRow(
  path: CurriculumPathDefinition,
  index: number,
  score: number,
  bestAttemptId = `attempt-${index}`,
): PersistedLessonProgress {
  return { lessonId: lessonAt(path, index).lesson.id, bestScore: score, bestAttemptId }
}

function firstLessonsPassed(
  path: CurriculumPathDefinition,
  count: number,
  score = 70,
): PersistedLessonProgress[] {
  return Array.from({ length: count }, (_, index) => progressRow(path, index, score))
}

function build(path: CurriculumPathDefinition, progress: readonly PersistedLessonProgress[]) {
  const outcome = buildCurriculumPathProgress({ path, progress })
  if (!outcome.ok) throw new Error(`${outcome.error.kind}: ${outcome.error.code}`)
  return outcome.value
}

describe('structured result navigation', () => {
  it('continues from an ordinary passed lesson to its immediate successor', () => {
    const path = makePath()
    const result = build(path, [progressRow(path, 0, 74)])
    const navigation = buildStructuredResultNavigation({
      state: 'passed',
      attemptId: 'attempt-pass',
      lesson: linkAt(path, 0),
      nextLesson: result.lessons[0]?.nextLesson ?? null,
    })

    expect(navigation.progression).toEqual({
      kind: 'continue',
      href: '/practice/paths/interviews/lessons/interviews-beginner-02-skill-2',
      lesson: linkAt(path, 1),
    })
  })

  it.each(['not_passed', 'neutral'] as const)(
    'offers no Continue action for a %s result',
    (state) => {
      const path = makePath()
      const navigation = buildStructuredResultNavigation({
        state,
        attemptId: 'attempt-retry',
        lesson: linkAt(path, 0),
        nextLesson: linkAt(path, 1),
      })

      expect(navigation.progression).toBeNull()
      expect(navigation.retry).toMatchObject({
        kind: 'retry',
        href: '/practice/paths/interviews/lessons/interviews-beginner-01-skill-1/record?retry=attempt-retry',
        lesson: linkAt(path, 0),
        retryOfAttemptId: 'attempt-retry',
      })
    },
  )

  it('keeps structured retry identity on the same lesson and parent attempt', () => {
    const path = makePath('conversations')
    const lesson = linkAt(path, 4)
    const navigation = buildStructuredResultNavigation({
      state: 'passed',
      attemptId: 'parent/attempt?one',
      lesson,
      nextLesson: linkAt(path, 5),
    })

    expect(navigation.retry).toEqual({
      kind: 'retry',
      href: '/practice/paths/conversations/lessons/conversations-beginner-05-skill-5/record?retry=parent%2Fattempt%3Fone',
      lesson,
      retryOfAttemptId: 'parent/attempt?one',
    })
  })

  it('continues from Beginner and Intermediate checkpoints into the next chapter', () => {
    const path = makePath()
    const beginner = build(path, firstLessonsPassed(path, 10, 73))
    const intermediate = build(path, firstLessonsPassed(path, 20, 73))

    expect(
      buildStructuredResultNavigation({
        state: 'passed',
        attemptId: 'beginner-checkpoint',
        lesson: linkAt(path, 9),
        nextLesson: beginner.lessons[9]?.nextLesson ?? null,
      }).progression,
    ).toMatchObject({
      kind: 'continue',
      href: '/practice/paths/interviews/lessons/interviews-intermediate-01-skill-1',
      lesson: { level: 'intermediate', position: 1 },
    })
    expect(
      buildStructuredResultNavigation({
        state: 'passed',
        attemptId: 'intermediate-checkpoint',
        lesson: linkAt(path, 19),
        nextLesson: intermediate.lessons[19]?.nextLesson ?? null,
      }).progression,
    ).toMatchObject({
      kind: 'continue',
      href: '/practice/paths/interviews/lessons/interviews-advanced-01-skill-1',
      lesson: { level: 'advanced', position: 1 },
    })
  })

  it('finishes at the Advanced checkpoint with View Path instead of a nonexistent lesson', () => {
    const path = makePath()
    const complete = build(path, firstLessonsPassed(path, 30, 92))
    const navigation = buildStructuredResultNavigation({
      state: 'passed',
      attemptId: 'advanced-checkpoint',
      lesson: linkAt(path, 29),
      nextLesson: complete.lessons[29]?.nextLesson ?? null,
    })

    expect(complete.summary.pathComplete).toBe(true)
    expect(navigation.progression).toEqual({
      kind: 'view_path',
      href: '/practice/paths/interviews',
      pathSlug: 'interviews',
    })
  })
})

describe('retry progression integration', () => {
  it('keeps 64 blocked, then 74 passes and unlocks Lesson 2', () => {
    const path = makePath()
    const beforeRetry = build(path, [progressRow(path, 0, 64, 'attempt-64')])
    const best = mergeBestAttempt(
      { attemptId: 'attempt-64', score: 64, finishedAt: '2026-08-28T10:00:00.000Z' },
      { attemptId: 'attempt-74', score: 74, finishedAt: '2026-08-28T11:00:00.000Z' },
    )
    if (!best) throw new Error('Expected a valid retry score.')
    const afterRetry = build(path, [progressRow(path, 0, best.score, best.attemptId)])

    expect(beforeRetry.lessons[0]).toMatchObject({
      state: 'retry_required',
      bestScore: 64,
      passed: false,
      stars: 0,
    })
    expect(beforeRetry.lessons[1]?.state).toBe('locked')
    expect(afterRetry.lessons[0]).toMatchObject({
      state: 'passed',
      bestScore: 74,
      bestAttemptId: 'attempt-74',
      passed: true,
      stars: 1,
    })
    expect(afterRetry.lessons[1]?.state).toBe('available')
  })

  it('keeps an 84 best after a 72 retry and preserves downstream unlocks', () => {
    const path = makePath()
    const best = mergeBestAttempt(
      { attemptId: 'attempt-84', score: 84, finishedAt: '2026-08-28T10:00:00.000Z' },
      { attemptId: 'attempt-72', score: 72, finishedAt: '2026-08-28T11:00:00.000Z' },
    )
    if (!best) throw new Error('Expected the stored best score.')
    const result = build(path, [
      progressRow(path, 0, best.score, best.attemptId),
      progressRow(path, 1, 70, 'attempt-lesson-2'),
    ])

    expect(best).toMatchObject({ attemptId: 'attempt-84', score: 84 })
    expect(result.lessons[0]).toMatchObject({ bestScore: 84, passed: true, stars: 2 })
    expect(result.lessons[1]).toMatchObject({ passed: true })
    expect(result.lessons[2]?.state).toBe('available')
  })

  it('keeps a checkpoint score of 68 blocked, then 73 unlocks the next chapter', () => {
    const path = makePath()
    const failed = build(path, [
      ...firstLessonsPassed(path, 9),
      progressRow(path, 9, 68, 'checkpoint-68'),
    ])
    const best = mergeBestAttempt(
      { attemptId: 'checkpoint-68', score: 68, finishedAt: '2026-08-28T10:00:00.000Z' },
      { attemptId: 'checkpoint-73', score: 73, finishedAt: '2026-08-28T11:00:00.000Z' },
    )
    if (!best) throw new Error('Expected a valid checkpoint retry score.')
    const passed = build(path, [
      ...firstLessonsPassed(path, 9),
      progressRow(path, 9, best.score, best.attemptId),
    ])

    expect(failed.lessons[9]).toMatchObject({ state: 'retry_required', bestScore: 68 })
    expect(failed.lessons[10]?.state).toBe('locked')
    expect(passed.lessons[9]).toMatchObject({ state: 'passed', bestScore: 73, stars: 1 })
    expect(passed.lessons[10]?.state).toBe('available')
  })
})
