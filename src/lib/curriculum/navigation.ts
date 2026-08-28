import {
  CHAPTER_LEVELS,
  PATH_MODES,
  PATH_POSITIONS,
  PATH_SLUGS,
  type CurriculumChapterDefinition,
  type CurriculumInputError,
  type CurriculumLessonDefinition,
  type CurriculumLessonLink,
  type CurriculumPathDefinition,
  type PathSlug,
} from '@/lib/curriculum/contracts'

export interface FlattenedCurriculumLesson {
  chapter: CurriculumChapterDefinition
  lesson: CurriculumLessonDefinition
  link: CurriculumLessonLink
}

export type ValidatedCurriculumPathOutcome =
  | { ok: true; value: CurriculumPathDefinition }
  | { ok: false; error: Extract<CurriculumInputError, { kind: 'invalid_curriculum' }> }

export type FlattenCurriculumPathOutcome =
  | {
      ok: true
      value: {
        path: CurriculumPathDefinition
        lessons: readonly FlattenedCurriculumLesson[]
      }
    }
  | { ok: false; error: Extract<CurriculumInputError, { kind: 'invalid_curriculum' }> }

type CurriculumErrorCode = Extract<CurriculumInputError, { kind: 'invalid_curriculum' }>['code']

function invalid(code: CurriculumErrorCode, message: string): ValidatedCurriculumPathOutcome {
  return { ok: false, error: { kind: 'invalid_curriculum', code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]+(?:-[a-z0-9]+)*$/.test(value)
}

function isPathSlug(value: unknown): value is PathSlug {
  return typeof value === 'string' && (PATH_SLUGS as readonly string[]).includes(value)
}

function validLessonShape(value: unknown): value is CurriculumLessonDefinition {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    isNonemptyString(value.chapterId) &&
    isSlug(value.slug) &&
    isNonemptyString(value.title) &&
    isNonemptyString(value.skillFocus) &&
    Number.isInteger(value.position) &&
    typeof value.checkpoint === 'boolean' &&
    isNonemptyString(value.promptId) &&
    typeof value.active === 'boolean'
  )
}

function validChapterShape(value: unknown): value is CurriculumChapterDefinition {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    isNonemptyString(value.pathId) &&
    typeof value.level === 'string' &&
    (CHAPTER_LEVELS as readonly string[]).includes(value.level) &&
    isNonemptyString(value.title) &&
    Number.isInteger(value.position) &&
    typeof value.active === 'boolean' &&
    Array.isArray(value.lessons)
  )
}

/**
 * Validates the persisted curriculum topology without sorting or repairing it.
 * Callers get an explicit data error instead of an apparently empty or locked path.
 */
export function validateCurriculumPathDefinition(value: unknown): ValidatedCurriculumPathOutcome {
  if (
    !isRecord(value) ||
    !isNonemptyString(value.id) ||
    !isPathSlug(value.slug) ||
    !isNonemptyString(value.title) ||
    typeof value.mode !== 'string' ||
    !Number.isInteger(value.position) ||
    typeof value.active !== 'boolean' ||
    !Array.isArray(value.chapters)
  ) {
    return invalid('invalid_path', 'The curriculum path is malformed.')
  }

  if (value.mode !== PATH_MODES[value.slug] || value.position !== PATH_POSITIONS[value.slug]) {
    return invalid('invalid_path_identity', 'The curriculum path identity is inconsistent.')
  }
  if (value.chapters.length !== CHAPTER_LEVELS.length) {
    return invalid(
      'invalid_chapter_count',
      'A curriculum path must contain exactly three chapters.',
    )
  }

  const identifiers = new Set<string>([value.id])
  const lessonSlugs = new Set<string>()
  const promptIds = new Set<string>()

  for (const [chapterIndex, chapterValue] of value.chapters.entries()) {
    if (!validChapterShape(chapterValue)) {
      return invalid('invalid_chapter_identity', 'A curriculum chapter is malformed.')
    }
    const expectedPosition = chapterIndex + 1
    if (
      chapterValue.pathId !== value.id ||
      chapterValue.position !== expectedPosition ||
      chapterValue.level !== CHAPTER_LEVELS[chapterIndex]
    ) {
      return invalid('invalid_chapter_identity', 'The curriculum chapter order is inconsistent.')
    }
    if (identifiers.has(chapterValue.id)) {
      return invalid('duplicate_identifier', 'Curriculum identifiers must be unique.')
    }
    identifiers.add(chapterValue.id)

    if (chapterValue.lessons.length !== 10) {
      return invalid(
        'invalid_lesson_count',
        'A curriculum chapter must contain exactly ten lessons.',
      )
    }

    for (const [lessonIndex, lessonValue] of chapterValue.lessons.entries()) {
      if (!validLessonShape(lessonValue)) {
        return invalid('invalid_lesson_identity', 'A curriculum lesson is malformed.')
      }
      const expectedLessonPosition = lessonIndex + 1
      if (
        lessonValue.chapterId !== chapterValue.id ||
        lessonValue.position !== expectedLessonPosition ||
        !lessonValue.slug.startsWith(
          `${value.slug}-${chapterValue.level}-${String(expectedLessonPosition).padStart(2, '0')}-`,
        )
      ) {
        return invalid('invalid_lesson_identity', 'The curriculum lesson order is inconsistent.')
      }
      if (lessonValue.checkpoint !== (expectedLessonPosition === 10)) {
        return invalid('invalid_checkpoint', 'Only lesson ten may be the chapter checkpoint.')
      }
      if (
        identifiers.has(lessonValue.id) ||
        lessonSlugs.has(lessonValue.slug) ||
        promptIds.has(lessonValue.promptId)
      ) {
        return invalid(
          'duplicate_identifier',
          'Lesson identifiers, slugs, and prompts must be unique.',
        )
      }
      identifiers.add(lessonValue.id)
      lessonSlugs.add(lessonValue.slug)
      promptIds.add(lessonValue.promptId)
    }
  }

  return { ok: true, value: value as unknown as CurriculumPathDefinition }
}

export function lessonLink(
  path: CurriculumPathDefinition,
  chapter: CurriculumChapterDefinition,
  lesson: CurriculumLessonDefinition,
): CurriculumLessonLink {
  return {
    id: lesson.id,
    slug: lesson.slug,
    pathSlug: path.slug,
    level: chapter.level,
    position: lesson.position,
  }
}

/** Beginner 1..10, then Intermediate 1..10, then Advanced 1..10. */
export function flattenCurriculumPath(value: unknown): FlattenCurriculumPathOutcome {
  const validated = validateCurriculumPathDefinition(value)
  if (!validated.ok) return validated

  const path = validated.value
  const lessons = path.chapters.flatMap((chapter) =>
    chapter.lessons.map((lesson) => ({
      chapter,
      lesson,
      link: lessonLink(path, chapter, lesson),
    })),
  )
  return { ok: true, value: { path, lessons } }
}
