import { describe, expect, it } from 'vitest'
import {
  CHAPTER_LEVELS,
  PATH_MODES,
  PATH_POSITIONS,
  type CurriculumPathDefinition,
  type CurriculumPathProgress,
  type PersistedLessonProgress,
} from '@/lib/curriculum/contracts'
import { buildCurriculumPathProgress } from '@/lib/curriculum/progression'
import { buildStructuredLessonResult } from '@/lib/curriculum/result'

function makePath(): CurriculumPathDefinition {
  const pathId = 'path-general-speaking'
  return {
    id: pathId,
    slug: 'general-speaking',
    title: 'General Speaking',
    mode: PATH_MODES['general-speaking'],
    position: PATH_POSITIONS['general-speaking'],
    active: true,
    chapters: CHAPTER_LEVELS.map((level, chapterIndex) => {
      const chapterId = `${pathId}-${level}`
      return {
        id: chapterId,
        pathId,
        level,
        title: `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`,
        position: chapterIndex + 1,
        active: true,
        lessons: Array.from({ length: 10 }, (_, lessonIndex) => {
          const position = lessonIndex + 1
          return {
            id: `lesson-${level}-${position}`,
            chapterId,
            slug: `general-speaking-${level}-${String(position).padStart(2, '0')}-skill-${position}`,
            title: `Lesson ${chapterIndex * 10 + position}`,
            skillFocus: `Focus ${position}`,
            position,
            checkpoint: position === 10,
            promptId: `prompt-${level}-${position}`,
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
  bestScore: number,
  bestAttemptId: string | null = `attempt-${index}`,
): PersistedLessonProgress {
  const lesson = path.chapters[Math.floor(index / 10)]?.lessons[index % 10]
  if (!lesson) throw new Error('Missing test lesson.')
  return { lessonId: lesson.id, bestScore, bestAttemptId }
}

function pathProgress(
  progress: readonly PersistedLessonProgress[],
  neutralLessonIds: readonly string[] = [],
): CurriculumPathProgress {
  const outcome = buildCurriculumPathProgress({
    path: makePath(),
    progress,
    attemptEvidence: neutralLessonIds.map((lessonId) => ({ lessonId })),
  })
  if (!outcome.ok) throw new Error(`${outcome.error.kind}: ${outcome.error.code}`)
  return outcome.value
}

function model(input: {
  lessonIndex?: number
  currentScore: number | null
  progress: readonly PersistedLessonProgress[]
  attemptId?: string
}) {
  const lessonIndex = input.lessonIndex ?? 0
  const path = pathProgress(input.progress)
  const lesson = path.lessons[lessonIndex]
  if (!lesson) throw new Error('Missing progress lesson.')
  const result = buildStructuredLessonResult({
    path,
    lessonId: lesson.lesson.id,
    attemptId: input.attemptId ?? 'current-attempt',
    currentScore: input.currentScore,
    snapshotScore: input.currentScore,
  })
  if (!result) throw new Error('Missing structured result.')
  return result
}

describe('structured lesson result thresholds', () => {
  it.each([45, 69])('classifies %s as not passed with no stars or continuation', (score) => {
    const path = makePath()
    const result = model({
      currentScore: score,
      progress: [progressRow(path, 0, score, 'current-attempt')],
    })

    expect(result).toMatchObject({
      state: 'not_passed',
      currentScore: score,
      currentStars: 0,
      bestScore: score,
      bestStars: 0,
      personalBest: true,
      primaryAction: { label: 'Try Again' },
      secondaryAction: null,
    })
    expect(result.primaryAction.href).toContain('?retry=current-attempt')
  })

  it.each([
    [70, 1],
    [79, 1],
    [80, 2],
    [89, 2],
    [90, 3],
    [100, 3],
  ] as const)('classifies %s as passed with %s current stars', (score, stars) => {
    const path = makePath()
    const result = model({
      currentScore: score,
      progress: [progressRow(path, 0, score, 'current-attempt')],
    })

    expect(result).toMatchObject({
      state: 'passed',
      currentScore: score,
      currentStars: stars,
      bestScore: score,
      bestStars: stars,
      personalBest: true,
      primaryAction: { label: 'Continue' },
    })
    expect(result.primaryAction.href).toContain('/lessons/general-speaking-beginner-02-')
  })
})

describe('structured lesson durable bests', () => {
  it.each([
    { scalar: 70, snapshot: 69 },
    { scalar: 70, snapshot: null },
    { scalar: null, snapshot: 70 },
    { scalar: 101, snapshot: 101 },
  ])('keeps a mismatched or invalid scalar/snapshot pair neutral', ({ scalar, snapshot }) => {
    const path = makePath()
    const progress = pathProgress([], [path.chapters[0]?.lessons[0]?.id ?? 'missing'])
    const lesson = progress.lessons[0]
    if (!lesson) throw new Error('Missing progress lesson.')

    expect(
      buildStructuredLessonResult({
        path: progress,
        lessonId: lesson.lesson.id,
        attemptId: 'current-attempt',
        currentScore: scalar,
        snapshotScore: snapshot,
      }),
    ).toMatchObject({
      state: 'neutral',
      currentScore: null,
      currentStars: 0,
      primaryAction: { label: 'Try Again' },
    })
  })

  it('keeps an authoritative higher best when a later passing attempt is lower', () => {
    const path = makePath()
    const result = model({
      currentScore: 72,
      progress: [progressRow(path, 0, 86, 'best-attempt')],
    })

    expect(result).toMatchObject({
      state: 'passed',
      currentScore: 72,
      currentStars: 1,
      bestScore: 86,
      bestStars: 2,
      bestAttemptId: 'best-attempt',
      personalBest: false,
      primaryAction: { label: 'Continue' },
    })
  })

  it('marks only the authoritative best-attempt link as a personal best', () => {
    const path = makePath()
    const current = model({
      currentScore: 92,
      progress: [progressRow(path, 0, 92, 'current-attempt')],
    })
    const other = model({
      currentScore: 92,
      progress: [progressRow(path, 0, 92, 'other-attempt')],
    })

    expect(current).toMatchObject({ personalBest: true, bestScore: 92, bestStars: 3 })
    expect(other).toMatchObject({ personalBest: false, bestScore: 92, bestStars: 3 })
  })

  it('keeps best score and stars coherent when the best-attempt link was deleted', () => {
    const path = makePath()
    const result = model({
      currentScore: 72,
      progress: [progressRow(path, 0, 86, null)],
    })

    expect(result).toMatchObject({
      currentScore: 72,
      currentStars: 1,
      bestScore: 86,
      bestStars: 2,
      bestAttemptId: null,
      personalBest: false,
    })
  })

  it('keeps a neutral attempt separate from an existing durable best', () => {
    const path = makePath()
    const result = model({
      currentScore: null,
      progress: [progressRow(path, 0, 86, 'best-attempt')],
    })

    expect(result).toMatchObject({
      state: 'neutral',
      currentScore: null,
      currentStars: 0,
      bestScore: 86,
      bestStars: 2,
      personalBest: false,
      primaryAction: { label: 'Try Again' },
      secondaryAction: null,
    })
  })
})

describe('structured lesson result navigation', () => {
  it('crosses a chapter boundary only after the checkpoint passes', () => {
    const path = makePath()
    const firstNine = Array.from({ length: 9 }, (_, index) => progressRow(path, index, 70))
    const blocked = model({
      lessonIndex: 9,
      currentScore: 68,
      progress: [...firstNine, progressRow(path, 9, 68, 'current-attempt')],
    })
    const continued = model({
      lessonIndex: 9,
      currentScore: 73,
      progress: [...firstNine, progressRow(path, 9, 73, 'current-attempt')],
    })

    expect(blocked).toMatchObject({
      state: 'not_passed',
      currentStars: 0,
      primaryAction: { label: 'Try Again' },
    })
    expect(continued).toMatchObject({
      state: 'passed',
      currentStars: 1,
      nextLesson: { level: 'intermediate', position: 1 },
      primaryAction: { label: 'Continue' },
    })
    expect(continued.primaryAction.href).toContain('/lessons/general-speaking-intermediate-01-')
  })

  it('ends the final checkpoint at View Path without inventing another lesson', () => {
    const path = makePath()
    const allPassed = Array.from({ length: 30 }, (_, index) =>
      progressRow(path, index, 70, index === 29 ? 'current-attempt' : `attempt-${index}`),
    )
    const result = model({ lessonIndex: 29, currentScore: 70, progress: allPassed })

    expect(result).toMatchObject({
      state: 'passed',
      pathComplete: true,
      nextLesson: null,
      primaryAction: { label: 'View Path', href: '/practice/paths/general-speaking' },
    })
  })
})
