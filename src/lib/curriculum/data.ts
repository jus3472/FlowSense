import {
  CHAPTER_LEVELS,
  PATH_SLUGS,
  type CurriculumChapterDefinition,
  type CurriculumLessonDefinition,
  type CurriculumLessonProgress,
  type CurriculumPathDefinition,
  type CurriculumPathProgress,
  type NeutralLessonAttemptEvidence,
  type PathSlug,
  type PersistedLessonProgress,
} from '@/lib/curriculum/contracts'
import { PRACTICE_MODES, PROMPT_DIFFICULTIES } from '@/lib/practice/contracts'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LESSON_SLUG_PATTERN = /^[a-z]+(?:-[a-z0-9]+)*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export function parsePathSlug(value: unknown): PathSlug | null {
  return includes(PATH_SLUGS, value) ? value : null
}

function parsePathRow(value: unknown): Omit<CurriculumPathDefinition, 'chapters'> | null {
  if (!isRecord(value)) return null
  const slug = parsePathSlug(value.slug)
  const title = nonEmptyString(value.title)
  if (
    !isUuid(value.id) ||
    slug === null ||
    title === null ||
    !includes(PRACTICE_MODES, value.mode) ||
    !positiveInteger(value.position) ||
    typeof value.active !== 'boolean'
  ) {
    return null
  }
  return {
    id: value.id,
    slug,
    title,
    mode: value.mode,
    position: value.position,
    active: value.active,
  } as Omit<CurriculumPathDefinition, 'chapters'>
}

function parseChapterRow(value: unknown): Omit<CurriculumChapterDefinition, 'lessons'> | null {
  if (!isRecord(value)) return null
  const title = nonEmptyString(value.title)
  if (
    !isUuid(value.id) ||
    !isUuid(value.path_id) ||
    !includes(CHAPTER_LEVELS, value.level) ||
    title === null ||
    !positiveInteger(value.position) ||
    typeof value.active !== 'boolean'
  ) {
    return null
  }
  return {
    id: value.id,
    pathId: value.path_id,
    level: value.level,
    title,
    position: value.position,
    active: value.active,
  }
}

export function parseCurriculumLessonRow(value: unknown): CurriculumLessonDefinition | null {
  if (!isRecord(value)) return null
  const title = nonEmptyString(value.title)
  const skillFocus = nonEmptyString(value.skill_focus)
  if (
    !isUuid(value.id) ||
    !isUuid(value.chapter_id) ||
    typeof value.slug !== 'string' ||
    !LESSON_SLUG_PATTERN.test(value.slug) ||
    title === null ||
    skillFocus === null ||
    !positiveInteger(value.position) ||
    typeof value.checkpoint !== 'boolean' ||
    !isUuid(value.prompt_id) ||
    typeof value.active !== 'boolean'
  ) {
    return null
  }
  return {
    id: value.id,
    chapterId: value.chapter_id,
    slug: value.slug,
    title,
    skillFocus,
    position: value.position,
    checkpoint: value.checkpoint,
    promptId: value.prompt_id,
    active: value.active,
  }
}

/** Converts separate query results into the nested definition consumed by progression. */
export function parseCurriculumPathRows(input: {
  path: unknown
  chapters: unknown
  lessons: unknown
}): CurriculumPathDefinition | null {
  const path = parsePathRow(input.path)
  if (!path || !Array.isArray(input.chapters) || !Array.isArray(input.lessons)) return null

  const chapters: Array<Omit<CurriculumChapterDefinition, 'lessons'>> = []
  for (const value of input.chapters) {
    const chapter = parseChapterRow(value)
    if (!chapter || chapter.pathId !== path.id) return null
    chapters.push(chapter)
  }

  const chapterIds = new Set(chapters.map((chapter) => chapter.id))

  const lessons: CurriculumLessonDefinition[] = []
  for (const value of input.lessons) {
    const lesson = parseCurriculumLessonRow(value)
    if (!lesson || !chapterIds.has(lesson.chapterId)) return null
    lessons.push(lesson)
  }

  return {
    ...path,
    chapters: chapters
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((chapter) => ({
        ...chapter,
        lessons: lessons
          .filter((lesson) => lesson.chapterId === chapter.id)
          .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)),
      })),
  }
}

export function parseLessonProgressRows(value: unknown): PersistedLessonProgress[] | null {
  if (!Array.isArray(value)) return null
  const progress: PersistedLessonProgress[] = []
  for (const row of value) {
    if (!isRecord(row) || !isUuid(row.lesson_id)) return null
    progress.push({
      lessonId: row.lesson_id,
      bestScore: row.best_score,
      bestAttemptId: row.best_attempt_id,
    })
  }
  return progress
}

export function neutralLessonEvidence(lessonIds: Iterable<string>): NeutralLessonAttemptEvidence[] {
  return [...new Set(lessonIds)].sort().map((lessonId) => ({ lessonId }))
}

export type CurriculumLessonAccessDecision =
  | {
      status: 'allowed'
      lesson: CurriculumLessonProgress
      chapter: CurriculumChapterDefinition
    }
  | { status: 'not_found' }
  | { status: 'denied'; reason: 'inactive' | 'locked' }

/** Pure authorization decision shared by every structured lesson entry point. */
export function decideCurriculumLessonAccess(
  path: CurriculumPathProgress,
  lessonSlug: string,
): CurriculumLessonAccessDecision {
  const lesson = path.lessons.find((candidate) => candidate.lesson.slug === lessonSlug)
  if (!lesson) return { status: 'not_found' }

  const chapter = path.chapters.find(
    (candidate) => candidate.chapter.id === lesson.lesson.chapterId,
  )?.chapter
  if (!chapter) return { status: 'not_found' }
  if (!path.path.active || !chapter.active || !lesson.lesson.active) {
    return { status: 'denied', reason: 'inactive' }
  }
  if (lesson.state === 'locked') return { status: 'denied', reason: 'locked' }
  return { status: 'allowed', lesson, chapter }
}

export interface CurriculumLessonSession {
  lessonId: string
  pathSlug: PathSlug
  chapterLevel: (typeof CHAPTER_LEVELS)[number]
  lessonSlug: string
  lessonPosition: number
  checkpoint: boolean
  promptId: string
  promptText: string
  mode: (typeof PRACTICE_MODES)[number]
  difficulty: (typeof PROMPT_DIFFICULTIES)[number]
  targetDurationSeconds: number
}

export type CurriculumPromptOutcome =
  | { status: 'ready'; data: CurriculumLessonSession }
  | { status: 'denied'; reason: 'inactive' }
  | { status: 'invalid_response' }

/** Validates the authoritative curriculum prompt against its path and lesson identity. */
export function curriculumPromptOutcome(
  value: unknown,
  expected: {
    lessonId: string
    pathSlug: PathSlug
    chapterLevel: (typeof CHAPTER_LEVELS)[number]
    lessonSlug: string
    lessonPosition: number
    checkpoint: boolean
    promptId: string
    mode: (typeof PRACTICE_MODES)[number]
    difficulty: (typeof PROMPT_DIFFICULTIES)[number]
  },
): CurriculumPromptOutcome {
  if (!isRecord(value)) return { status: 'invalid_response' }
  const text = nonEmptyString(value.text)
  if (
    typeof value.active !== 'boolean' ||
    !isUuid(value.id) ||
    value.id !== expected.promptId ||
    text === null ||
    value.free_practice_visible !== false ||
    value.mode !== expected.mode ||
    value.difficulty !== expected.difficulty ||
    typeof value.target_duration_seconds !== 'number' ||
    !Number.isInteger(value.target_duration_seconds) ||
    value.target_duration_seconds < 15 ||
    value.target_duration_seconds > 600
  ) {
    return { status: 'invalid_response' }
  }
  if (!value.active) return { status: 'denied', reason: 'inactive' }
  return {
    status: 'ready',
    data: {
      lessonId: expected.lessonId,
      pathSlug: expected.pathSlug,
      chapterLevel: expected.chapterLevel,
      lessonSlug: expected.lessonSlug,
      lessonPosition: expected.lessonPosition,
      checkpoint: expected.checkpoint,
      promptId: value.id,
      promptText: text,
      mode: expected.mode,
      difficulty: expected.difficulty,
      targetDurationSeconds: value.target_duration_seconds,
    },
  }
}
