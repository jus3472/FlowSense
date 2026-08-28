import {
  CHAPTER_LEVELS,
  CURRICULUM_ATTEMPT_STATUSES,
  PATH_MODES,
  PATH_POSITIONS,
  type CurriculumPathDefinition,
  type PathSlug,
  type PersistedLessonProgress,
} from '@/lib/curriculum/contracts'
import {
  buildCurriculumPathProgress,
  mergeBestAttempt,
  type LessonAttemptCandidate,
} from '@/lib/curriculum/progression'
import {
  flattenCurriculumPath,
  validateCurriculumPathDefinition,
} from '@/lib/curriculum/navigation'
import { starsForScore } from '@/lib/curriculum/thresholds'
import { describe, expect, it } from 'vitest'

function makePath(slug: PathSlug = 'general-speaking'): CurriculumPathDefinition {
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

function progressRow(
  path: CurriculumPathDefinition,
  index: number,
  score: unknown,
  bestAttemptId: unknown = `attempt-${index}`,
): PersistedLessonProgress {
  const chapter = path.chapters[Math.floor(index / 10)]
  const lesson = chapter?.lessons[index % 10]
  if (!lesson) throw new Error('Test lesson index is outside the curriculum.')
  return { lessonId: lesson.id, bestScore: score, bestAttemptId }
}

function firstLessonsPassed(
  path: CurriculumPathDefinition,
  count: number,
  score = 70,
): PersistedLessonProgress[] {
  return Array.from({ length: count }, (_, index) => progressRow(path, index, score))
}

function build(
  path: CurriculumPathDefinition,
  progress: readonly PersistedLessonProgress[] = [],
  attemptEvidence: readonly { lessonId: string }[] = [],
) {
  const outcome = buildCurriculumPathProgress({ path, progress, attemptEvidence })
  if (!outcome.ok) throw new Error(`${outcome.error.kind}: ${outcome.error.code}`)
  return outcome.value
}

describe('curriculum navigation validation', () => {
  it('freezes attempt states and flattens the exact thirty-lesson order', () => {
    const path = makePath()
    const outcome = flattenCurriculumPath(path)

    expect(CURRICULUM_ATTEMPT_STATUSES).toEqual(['none', 'neutral', 'scored'])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.lessons).toHaveLength(30)
    expect(
      outcome.value.lessons.map(({ chapter, lesson }) => [chapter.level, lesson.position]),
    ).toEqual(
      CHAPTER_LEVELS.flatMap((level) =>
        Array.from({ length: 10 }, (_, index) => [level, index + 1]),
      ),
    )
  })

  it.each([
    ['chapter count', (path: CurriculumPathDefinition) => path.chapters.slice(0, 2)],
    [
      'chapter order',
      (path: CurriculumPathDefinition) => [path.chapters[1], path.chapters[0], path.chapters[2]],
    ],
  ])('fails closed for malformed %s', (_label, chaptersFor) => {
    const path = makePath()
    const malformed = { ...path, chapters: chaptersFor(path) }
    const outcome = validateCurriculumPathDefinition(malformed)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.kind).toBe('invalid_curriculum')
  })

  it('rejects malformed lesson order and checkpoint placement', () => {
    const path = makePath()
    const chapter = path.chapters[0]
    if (!chapter) throw new Error('Missing test chapter.')
    const malformedPosition = {
      ...path,
      chapters: [
        {
          ...chapter,
          lessons: chapter.lessons.map((lesson, index) =>
            index === 1 ? { ...lesson, position: 3 } : lesson,
          ),
        },
        ...path.chapters.slice(1),
      ],
    }
    const malformedCheckpoint = {
      ...path,
      chapters: [
        {
          ...chapter,
          lessons: chapter.lessons.map((lesson, index) =>
            index === 0 ? { ...lesson, checkpoint: true } : lesson,
          ),
        },
        ...path.chapters.slice(1),
      ],
    }
    const malformedSlug = {
      ...path,
      chapters: [
        {
          ...chapter,
          lessons: chapter.lessons.map((lesson, index) =>
            index === 0 ? { ...lesson, slug: 'interviews-beginner-01-skill' } : lesson,
          ),
        },
        ...path.chapters.slice(1),
      ],
    }

    expect(validateCurriculumPathDefinition(malformedPosition)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_curriculum', code: 'invalid_lesson_identity' },
    })
    expect(validateCurriculumPathDefinition(malformedCheckpoint)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_curriculum', code: 'invalid_checkpoint' },
    })
    expect(validateCurriculumPathDefinition(malformedSlug)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_curriculum', code: 'invalid_lesson_identity' },
    })
  })
})

describe('curriculum score and retry boundaries', () => {
  it.each([
    [null, 0],
    [0, 0],
    [1, 0],
    [69, 0],
    [70, 1],
    [79, 1],
    [80, 2],
    [89, 2],
    [90, 3],
    [100, 3],
  ] as const)('maps %s to %s stars', (score, stars) => {
    expect(starsForScore(score)).toBe(stars)
  })

  it.each([45, 69])('keeps score %s below passing', (score) => {
    const path = makePath()
    const result = build(path, [progressRow(path, 0, score)])

    expect(result.lessons[0]).toMatchObject({
      state: 'retry_required',
      passed: false,
      stars: 0,
      attempted: true,
      attemptStatus: 'scored',
    })
    expect(result.lessons[1]?.state).toBe('locked')
  })

  it.each([
    [70, 1],
    [74, 1],
    [86, 2],
    [92, 3],
  ])('passes score %s with %s star(s)', (score, stars) => {
    const path = makePath()
    expect(build(path, [progressRow(path, 0, score)]).lessons[0]).toMatchObject({
      state: 'passed',
      passed: true,
      stars,
    })
  })

  it('preserves a higher best and upgrades only when a retry improves it', () => {
    const current: LessonAttemptCandidate = {
      attemptId: 'current',
      score: 86,
      finishedAt: '2026-08-27T12:00:00.000Z',
    }
    const lower = mergeBestAttempt(current, {
      attemptId: 'lower',
      score: 73,
      finishedAt: '2026-08-28T12:00:00.000Z',
    })
    const upgraded = mergeBestAttempt(current, {
      attemptId: 'higher',
      score: 92,
      finishedAt: '2026-08-28T12:00:00.000Z',
    })
    const neutral = mergeBestAttempt(current, {
      attemptId: 'neutral',
      score: null,
      finishedAt: '2026-08-29T12:00:00.000Z',
    })

    expect(lower).toMatchObject({ attemptId: 'current', score: 86 })
    expect(upgraded).toMatchObject({ attemptId: 'higher', score: 92 })
    expect(neutral).toMatchObject({ attemptId: 'current', score: 86 })
  })
})

describe('strict sequential curriculum progression', () => {
  it('starts only Beginner lesson one and links adjacent lessons', () => {
    const result = build(makePath())

    expect(result.lessons[0]).toMatchObject({
      state: 'available',
      attempted: false,
      bestScore: null,
    })
    expect(result.lessons.slice(1).every((lesson) => lesson.state === 'locked')).toBe(true)
    expect(result.lessons[0]?.previousLesson).toBeNull()
    expect(result.lessons[0]?.nextLesson?.position).toBe(2)
    expect(result.lessons[10]?.previousLesson).toMatchObject({ level: 'beginner', position: 10 })
    expect(result.lessons[10]?.nextLesson).toMatchObject({ level: 'intermediate', position: 2 })
    expect(result.lessons[29]?.nextLesson).toBeNull()
  })

  it('unlocks only the immediate successor after a pass', () => {
    const path = makePath()
    const passed = build(path, [progressRow(path, 0, 70)])
    const failed = build(path, [progressRow(path, 0, 69)])

    expect(passed.lessons[1]?.state).toBe('available')
    expect(passed.lessons[2]?.state).toBe('locked')
    expect(failed.lessons[1]?.state).toBe('locked')
  })

  it('uses checkpoint passage to cross chapter boundaries', () => {
    const path = makePath()
    const beginnerNine = build(path, firstLessonsPassed(path, 9))
    const beginnerCheckpointFailed = build(path, [
      ...firstLessonsPassed(path, 9),
      progressRow(path, 9, 69),
    ])
    const beginnerComplete = build(path, firstLessonsPassed(path, 10))
    const intermediateComplete = build(path, firstLessonsPassed(path, 20))

    expect(beginnerNine.lessons[9]?.state).toBe('available')
    expect(beginnerNine.chapters[0]?.chapterComplete).toBe(false)
    expect(beginnerCheckpointFailed.lessons[10]?.state).toBe('locked')
    expect(beginnerComplete.lessons[10]?.state).toBe('available')
    expect(beginnerComplete.chapters[0]?.chapterComplete).toBe(true)
    expect(intermediateComplete.lessons[20]?.state).toBe('available')
    expect(intermediateComplete.chapters[1]?.chapterComplete).toBe(true)
  })

  it('completes the path only when all thirty lessons and the advanced checkpoint pass', () => {
    const path = makePath()
    const beforeCheckpoint = build(path, firstLessonsPassed(path, 29))
    const complete = build(path, firstLessonsPassed(path, 30))

    expect(beforeCheckpoint.summary.pathComplete).toBe(false)
    expect(beforeCheckpoint.lessons[29]?.state).toBe('available')
    expect(complete.summary.pathComplete).toBe(true)
    expect(complete.chapters[2]?.chapterComplete).toBe(true)
    expect(complete.summary.nextAction).toEqual({ kind: 'complete' })
  })
})

describe('neutral and permanent progress', () => {
  it('counts neutral evidence as attempted without scoring, failing, or unlocking', () => {
    const path = makePath()
    const firstLessonId = path.chapters[0]?.lessons[0]?.id
    if (!firstLessonId) throw new Error('Missing first test lesson.')
    const result = build(path, [], [{ lessonId: firstLessonId }])

    expect(result.lessons[0]).toMatchObject({
      state: 'available',
      bestScore: null,
      bestAttemptId: null,
      stars: 0,
      passed: false,
      attempted: true,
      attemptStatus: 'neutral',
    })
    expect(result.lessons[1]?.state).toBe('locked')
    expect(result.summary.attemptedLessons).toBe(1)
    expect(result.summary.nextAction).toMatchObject({ kind: 'start' })
  })

  it('lets a later valid pass proceed normally after neutral evidence', () => {
    const path = makePath()
    const firstLessonId = path.chapters[0]?.lessons[0]?.id
    if (!firstLessonId) throw new Error('Missing first test lesson.')
    const result = build(path, [progressRow(path, 0, 74)], [{ lessonId: firstLessonId }])

    expect(result.lessons[0]).toMatchObject({ attemptStatus: 'scored', passed: true, stars: 1 })
    expect(result.lessons[1]?.state).toBe('available')
  })

  it('preserves permanent score, stars, and unlocks after the best attempt link is deleted', () => {
    const path = makePath()
    const result = build(path, [progressRow(path, 0, 86, null)])

    expect(result.lessons[0]).toMatchObject({
      bestScore: 86,
      bestAttemptId: null,
      passed: true,
      stars: 2,
    })
    expect(result.lessons[1]?.state).toBe('available')
  })

  it('rejects malformed, duplicate, unknown, and unreachable progress explicitly', () => {
    const path = makePath()
    const valid = progressRow(path, 0, 70)
    const second = progressRow(path, 1, 70)

    expect(
      buildCurriculumPathProgress({ path, progress: [{ ...valid, bestScore: null }] }),
    ).toMatchObject({
      ok: false,
      error: { kind: 'invalid_progress', code: 'invalid_progress_row' },
    })
    expect(buildCurriculumPathProgress({ path, progress: [valid, valid] })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_progress', code: 'duplicate_progress' },
    })
    expect(
      buildCurriculumPathProgress({ path, progress: [{ ...valid, lessonId: 'other-path' }] }),
    ).toMatchObject({
      ok: false,
      error: { kind: 'invalid_progress', code: 'unknown_progress_lesson' },
    })
    expect(buildCurriculumPathProgress({ path, progress: [second] })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_progress', code: 'unreachable_progress' },
    })
  })
})

describe('path and chapter aggregation', () => {
  it('aggregates attempts, passes, mastery, stars, checkpoints, and the current retry', () => {
    const path = makePath()
    const progress = [...firstLessonsPassed(path, 9, 90), progressRow(path, 9, 69)]
    const result = build(path, progress)

    expect(result.chapters[0]).toMatchObject({
      totalLessons: 10,
      attemptedLessons: 10,
      passedLessons: 9,
      masteredLessons: 9,
      earnedStars: 27,
      maximumStars: 30,
      checkpointState: 'retry_required',
      chapterUnlocked: true,
      chapterComplete: false,
    })
    expect(result.chapters[1]).toMatchObject({ chapterUnlocked: false, chapterComplete: false })
    expect(result.summary).toMatchObject({
      totalLessons: 30,
      attemptedLessons: 10,
      passedLessons: 9,
      masteredLessons: 9,
      earnedStars: 27,
      maximumStars: 90,
      pathComplete: false,
      nextAction: { kind: 'retry', requiredScore: 70 },
    })
    expect(result.summary.currentChapter).toMatchObject({ level: 'beginner', position: 1 })
    expect(result.summary.currentLesson).toMatchObject({ level: 'beginner', position: 10 })
  })

  it('selects start for the first untouched lesson after prior passes', () => {
    const path = makePath()
    const result = build(path, firstLessonsPassed(path, 5))

    expect(result.summary.currentLesson).toMatchObject({ level: 'beginner', position: 6 })
    expect(result.summary.nextAction).toMatchObject({ kind: 'start' })
  })

  it('keeps path progression independent from another path and from preferences', () => {
    const interviews = makePath('interviews')
    const presentations = makePath('presentations')
    const interviewResult = build(interviews, firstLessonsPassed(interviews, 5))
    const presentationResult = build(presentations)

    expect(interviewResult.summary.passedLessons).toBe(5)
    expect(interviewResult.summary.currentLesson).toMatchObject({
      pathSlug: 'interviews',
      position: 6,
    })
    expect(presentationResult.summary.passedLessons).toBe(0)
    expect(presentationResult.summary.currentLesson).toMatchObject({
      pathSlug: 'presentations',
      position: 1,
    })
    expect(Object.keys(interviewResult.summary)).not.toContain('preference')
  })
})
